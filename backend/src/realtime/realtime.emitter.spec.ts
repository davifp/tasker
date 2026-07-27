import { describe, it, expect, vi } from 'vitest';
import type { Server } from 'socket.io';
import { RealtimeEmitter, taskRoom, userRoom, workspaceRoom } from './realtime.emitter';

function fakeServer() {
  const emit = vi.fn();
  const server = {
    to: vi.fn().mockReturnValue({ emit }),
  } as unknown as Server & { to: ReturnType<typeof vi.fn> };
  return { server, emit };
}

describe('RealtimeEmitter.roomsFor', () => {
  const emitter = new RealtimeEmitter();

  it('routes task events to the task room and the workspace room', () => {
    expect(
      emitter.roomsFor({
        type: 'task.updated',
        workspaceId: 'ws-1',
        taskId: 't-1',
        payload: {},
      }),
    ).toEqual([taskRoom('ws-1', 't-1'), workspaceRoom('ws-1')]);
  });

  it('routes comment events to the task room and the workspace room', () => {
    expect(
      emitter.roomsFor({
        type: 'comment.created',
        workspaceId: 'ws-1',
        taskId: 't-1',
        commentId: 'c-1',
      }),
    ).toEqual([taskRoom('ws-1', 't-1'), workspaceRoom('ws-1')]);
  });

  it('routes sprint updates to the workspace room only', () => {
    expect(
      emitter.roomsFor({
        type: 'sprint.updated',
        workspaceId: 'ws-1',
        sprintId: 's-1',
        state: 'ACTIVE',
      }),
    ).toEqual([workspaceRoom('ws-1')]);
  });

  it('routes notification.new to the recipient user room only', () => {
    expect(
      emitter.roomsFor({
        type: 'notification.new',
        workspaceId: 'ws-1',
        recipientUserId: 'u-1',
        notificationId: 'n-1',
      }),
    ).toEqual([userRoom('u-1')]);
  });
});

describe('RealtimeEmitter.emit', () => {
  it('emits to every room returned by roomsFor', async () => {
    const { server, emit } = fakeServer();
    const emitter = new RealtimeEmitter();
    emitter.bind(server);
    await emitter.emit({
      type: 'task.moved',
      workspaceId: 'ws-1',
      taskId: 't-1',
      payload: { position: 'aa' },
    });
    expect(server.to).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith(
      'task.moved',
      expect.objectContaining({ type: 'task.moved' }),
    );
  });

  it('drops a malformed event without throwing', async () => {
    const { server } = fakeServer();
    const emitter = new RealtimeEmitter();
    emitter.bind(server);
    // @ts-expect-error — deliberately invalid
    await emitter.emit({ type: 'unknown.event', workspaceId: 'ws-1' });
    expect(server.to).not.toHaveBeenCalled();
  });

  it('applies the scrubber to the payload before broadcasting', async () => {
    const { server, emit } = fakeServer();
    const emitter = new RealtimeEmitter();
    emitter.bind(server);
    emitter.setScrubber(() => ({
      type: 'notification.new',
      workspaceId: 'ws-1',
      recipientUserId: 'u-1',
      notificationId: 'n-scrubbed',
    }));
    await emitter.emit({
      type: 'notification.new',
      workspaceId: 'ws-1',
      recipientUserId: 'u-1',
      notificationId: 'n-original',
    });
    expect(emit).toHaveBeenCalledWith(
      'notification.new',
      expect.objectContaining({ notificationId: 'n-scrubbed' }),
    );
  });

  it('no-ops when no server is bound (test-only scenario)', async () => {
    const emitter = new RealtimeEmitter();
    await expect(
      emitter.emit({
        type: 'notification.new',
        workspaceId: 'ws-1',
        recipientUserId: 'u-1',
        notificationId: 'n-1',
      }),
    ).resolves.toBeUndefined();
  });
});
