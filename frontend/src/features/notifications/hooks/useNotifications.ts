import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationKeys } from '@/features/queryKeys';
import {
  notificationsHttp,
  type NotificationEventType,
  type NotificationItem,
  type PreferenceEntry,
  type PreferencesResponse,
  type UnreadCount,
  type UpdatePreferencesInput,
} from '@/lib/http/notifications';
import type { CursorPage } from '@/lib/http/types';

interface UseNotificationsOptions {
  workspaceSlug: string;
  unreadOnly?: boolean;
  type?: NotificationEventType;
  pageLimit?: number;
  enabled?: boolean;
}

// Paginated bell list. Realtime `notification.new` events invalidate the
// broad `['notifications', workspaceSlug]` prefix so a mutation elsewhere
// or a new incoming notification refetches the first page without a manual
// reset here.
export function useNotifications(opts: UseNotificationsOptions) {
  return useInfiniteQuery<CursorPage<NotificationItem>, unknown>({
    queryKey: notificationKeys.list(opts.workspaceSlug, {
      unreadOnly: opts.unreadOnly,
      type: opts.type,
      limit: opts.pageLimit,
    }),
    queryFn: ({ pageParam }) =>
      notificationsHttp.list({
        cursor: typeof pageParam === 'string' ? pageParam : undefined,
        limit: opts.pageLimit ?? 30,
        ...(opts.unreadOnly ? { unreadOnly: true } : {}),
        ...(opts.type ? { type: opts.type } : {}),
      }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: opts.enabled ?? Boolean(opts.workspaceSlug),
    staleTime: 15_000,
  });
}

export function useUnreadCount(workspaceSlug: string, enabled = true) {
  return useQuery<UnreadCount>({
    queryKey: notificationKeys.unreadCount(workspaceSlug),
    queryFn: () => notificationsHttp.unreadCount(),
    enabled: enabled && Boolean(workspaceSlug),
    staleTime: 15_000,
  });
}

// Single-row mark-read with an optimistic patch across every list page so
// the item's read badge flips immediately, plus an optimistic decrement of
// the unread count. Rollback restores both caches on error.
export function useMarkRead(workspaceSlug: string) {
  const queryClient = useQueryClient();
  const listPrefix = notificationKeys.all(workspaceSlug);
  const countKey = notificationKeys.unreadCount(workspaceSlug);

  return useMutation<
    void,
    unknown,
    { id: string },
    { previousCount: UnreadCount | undefined; previousLists: Array<[unknown, unknown]> }
  >({
    mutationFn: ({ id }) => notificationsHttp.markRead(id),
    async onMutate({ id }) {
      await queryClient.cancelQueries({ queryKey: listPrefix });
      const previousCount = queryClient.getQueryData<UnreadCount>(countKey);
      const previousLists: Array<[unknown, unknown]> = [];
      const now = new Date().toISOString();
      queryClient
        .getQueriesData<{ pages: CursorPage<NotificationItem>[] } | CursorPage<NotificationItem>>({
          queryKey: listPrefix,
        })
        .forEach(([key, data]) => {
          if (!data) return;
          previousLists.push([key, data]);
          if ('pages' in (data as { pages?: unknown[] })) {
            const pages = (data as { pages: CursorPage<NotificationItem>[] }).pages.map((page) => ({
              ...page,
              items: page.items.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: now } : n)),
            }));
            queryClient.setQueryData(key, { ...(data as object), pages });
          } else if ('items' in (data as CursorPage<NotificationItem>)) {
            const page = data as CursorPage<NotificationItem>;
            queryClient.setQueryData(key, {
              ...page,
              items: page.items.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: now } : n)),
            });
          }
        });
      if (previousCount && previousCount.count > 0) {
        queryClient.setQueryData<UnreadCount>(countKey, {
          count: Math.max(0, previousCount.count - 1),
        });
      }
      return { previousCount, previousLists };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previousCount) queryClient.setQueryData(countKey, ctx.previousCount);
      for (const [key, prev] of ctx?.previousLists ?? []) {
        queryClient.setQueryData(key as never, prev as never);
      }
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: listPrefix });
    },
  });
}

export function useMarkAllRead(workspaceSlug: string) {
  const queryClient = useQueryClient();
  const listPrefix = notificationKeys.all(workspaceSlug);
  const countKey = notificationKeys.unreadCount(workspaceSlug);

  return useMutation<{ updated: number }, unknown, void>({
    mutationFn: () => notificationsHttp.markAllRead(),
    onSuccess() {
      queryClient.setQueryData<UnreadCount>(countKey, { count: 0 });
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: listPrefix });
    },
  });
}

export function usePreferences() {
  return useQuery<PreferencesResponse>({
    queryKey: notificationKeys.preferences(),
    queryFn: () => notificationsHttp.getPreferences(),
    staleTime: 60_000,
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  const key = notificationKeys.preferences();
  return useMutation<
    void,
    unknown,
    UpdatePreferencesInput,
    { previous: PreferencesResponse | undefined }
  >({
    mutationFn: (input) => notificationsHttp.updatePreferences(input),
    async onMutate(input) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PreferencesResponse>(key);
      if (previous) {
        const map = new Map<string, PreferenceEntry>();
        for (const item of previous.items) map.set(`${item.eventType}:${item.channel}`, item);
        for (const entry of input.preferences) {
          map.set(`${entry.eventType}:${entry.channel}`, entry);
        }
        queryClient.setQueryData<PreferencesResponse>(key, { items: Array.from(map.values()) });
      }
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
