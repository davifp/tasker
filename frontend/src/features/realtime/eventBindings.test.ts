import { describe, it, expect } from 'vitest';
import { keysFor, type RealtimeEvent } from './eventBindings';

const ctx = { workspaceSlug: 'acme' };

describe('eventBindings.keysFor', () => {
  it('routes task.updated to tasks and dashboard prefixes', () => {
    const event: RealtimeEvent = {
      type: 'task.updated',
      workspaceId: 'ws-1',
      taskId: 't-1',
      payload: {},
    };
    expect(keysFor(event, ctx)).toEqual([
      ['tasks', 'acme'],
      ['dashboard', 'acme'],
    ]);
  });

  it('routes task.moved to the same prefixes as task.updated', () => {
    const event: RealtimeEvent = {
      type: 'task.moved',
      workspaceId: 'ws-1',
      taskId: 't-1',
      payload: { position: 'aa' },
    };
    expect(keysFor(event, ctx)).toEqual([
      ['tasks', 'acme'],
      ['dashboard', 'acme'],
    ]);
  });

  it('routes task.deleted to tasks and dashboard prefixes', () => {
    const event: RealtimeEvent = {
      type: 'task.deleted',
      workspaceId: 'ws-1',
      taskId: 't-1',
      payload: {},
    };
    expect(keysFor(event, ctx)).toEqual([
      ['tasks', 'acme'],
      ['dashboard', 'acme'],
    ]);
  });

  it.each(['comment.created', 'comment.updated', 'comment.deleted'] as const)(
    'routes %s to the tasks prefix (comments hang off task detail)',
    (type) => {
      const event: RealtimeEvent = {
        type,
        workspaceId: 'ws-1',
        taskId: 't-1',
        commentId: 'c-1',
      };
      expect(keysFor(event, ctx)).toEqual([['tasks', 'acme']]);
    },
  );

  it('routes activity.added to the tasks prefix', () => {
    const event: RealtimeEvent = {
      type: 'activity.added',
      workspaceId: 'ws-1',
      taskId: 't-1',
      entryId: 'a-1',
    };
    expect(keysFor(event, ctx)).toEqual([['tasks', 'acme']]);
  });

  it('routes sprint.updated to sprints, dashboard and tasks', () => {
    const event: RealtimeEvent = {
      type: 'sprint.updated',
      workspaceId: 'ws-1',
      sprintId: 's-1',
      state: 'ACTIVE',
    };
    expect(keysFor(event, ctx)).toEqual([
      ['sprints', 'acme'],
      ['dashboard', 'acme'],
      ['tasks', 'acme'],
    ]);
  });

  it('routes notification.new to the notifications prefix only', () => {
    const event: RealtimeEvent = {
      type: 'notification.new',
      workspaceId: 'ws-1',
      recipientUserId: 'u-1',
      notificationId: 'n-1',
    };
    expect(keysFor(event, ctx)).toEqual([['notifications', 'acme']]);
  });
});
