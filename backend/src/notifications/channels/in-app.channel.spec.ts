import { describe, it, expect, vi } from 'vitest';
import type { Notification } from '@prisma/client';
import type { RealtimeEmitter } from '../../realtime/realtime.emitter';
import { InAppChannel } from './in-app.channel';

function fakeNotification(overrides?: Partial<Notification>): Notification {
  return {
    id: 'n-1',
    workspaceId: 'ws-1',
    recipientUserId: 'user-a',
    actorUserId: 'actor-1',
    eventType: 'COMMENT_MENTION',
    sourceKind: 'COMMENT',
    sourceId: 'c-1',
    payload: {},
    readAt: null,
    createdAt: new Date('2026-07-27T12:00:00Z'),
    ...overrides,
  } as unknown as Notification;
}

describe('InAppChannel', () => {
  it('emits notification.new to the recipient user room via RealtimeEmitter', async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    const emitter = { emit } as unknown as RealtimeEmitter;
    const channel = new InAppChannel(emitter);
    await channel.deliver(fakeNotification());
    expect(emit).toHaveBeenCalledWith({
      type: 'notification.new',
      workspaceId: 'ws-1',
      recipientUserId: 'user-a',
      notificationId: 'n-1',
    });
  });
});
