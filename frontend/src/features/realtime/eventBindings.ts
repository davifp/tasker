import type { QueryClient, QueryKey } from '@tanstack/react-query';

// The realtime wire event union is shared with the backend via @tasker/config.
// We re-declare the type locally as a discriminated union so the frontend does
// not gain a runtime dependency on the whole package.
export type RealtimeEvent =
  | {
      type: 'task.updated' | 'task.moved' | 'task.deleted';
      workspaceId: string;
      taskId: string;
      payload: Record<string, unknown>;
    }
  | {
      type: 'comment.created' | 'comment.updated' | 'comment.deleted';
      workspaceId: string;
      taskId: string;
      commentId: string;
    }
  | { type: 'activity.added'; workspaceId: string; taskId: string; entryId: string }
  | {
      type: 'sprint.updated';
      workspaceId: string;
      sprintId: string;
      state: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
    }
  | {
      type: 'notification.new';
      workspaceId: string;
      recipientUserId: string;
      notificationId: string;
    };

export const REALTIME_EVENT_NAMES = [
  'task.updated',
  'task.moved',
  'task.deleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'activity.added',
  'sprint.updated',
  'notification.new',
] as const;
export type RealtimeEventName = (typeof REALTIME_EVENT_NAMES)[number];

// Broad `invalidateQueries` mapping: each event type maps to a small set of
// query-key prefixes that a client in this workspace might have cached.
// Uses workspaceSlug (not workspaceId) because that is how queryKeys.ts is
// keyed. The provider passes it into the binder so the caller does not need
// to look it up per event.
export function invalidateFor(
  event: RealtimeEvent,
  client: QueryClient,
  ctx: { workspaceSlug: string },
): void {
  const invalidate = (queryKey: QueryKey) => {
    void client.invalidateQueries({ queryKey });
  };
  switch (event.type) {
    case 'task.updated':
    case 'task.moved':
    case 'task.deleted':
      invalidate(['tasks', ctx.workspaceSlug]);
      invalidate(['dashboard', ctx.workspaceSlug]);
      break;
    case 'comment.created':
    case 'comment.updated':
    case 'comment.deleted':
      // Comments live under the task detail subtree; broad invalidation on
      // ['tasks', workspaceSlug] refetches both the list badge counts and
      // any open task detail's comments list.
      invalidate(['tasks', ctx.workspaceSlug]);
      break;
    case 'activity.added':
      invalidate(['tasks', ctx.workspaceSlug]);
      break;
    case 'sprint.updated':
      invalidate(['sprints', ctx.workspaceSlug]);
      invalidate(['dashboard', ctx.workspaceSlug]);
      invalidate(['tasks', ctx.workspaceSlug]);
      break;
    case 'notification.new':
      // Prefix invalidation catches both `notificationKeys.list(...)` and
      // `notificationKeys.unreadCount(...)` because both start with
      // `['notifications', workspaceSlug]`. Preferences live under
      // `['notifications', 'preferences']` (no workspace segment) and are
      // intentionally out of scope for realtime — they never change from
      // an incoming notification.
      invalidate(['notifications', ctx.workspaceSlug]);
      break;
  }
}

// Returned for tests: given an event, what prefixes will be invalidated?
// Pure function so contract tests do not need a QueryClient.
export function keysFor(event: RealtimeEvent, ctx: { workspaceSlug: string }): QueryKey[] {
  const captured: QueryKey[] = [];
  const client = {
    invalidateQueries: (opts: { queryKey: QueryKey }) => {
      captured.push(opts.queryKey);
      return Promise.resolve();
    },
  } as unknown as QueryClient;
  invalidateFor(event, client, ctx);
  return captured;
}
