'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { NotificationList } from './NotificationList';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from './hooks/useNotifications';
import { useWorkspaceRole } from '@/features/workspace/context/WorkspaceRoleContext';
import type { NotificationEventType } from '@/lib/http/notifications';

interface Props {
  workspaceSlug: string;
}

const EVENT_TYPES: NotificationEventType[] = [
  'COMMENT_MENTION',
  'TASK_ASSIGNED',
  'COMMENT_FOLLOWED',
  'SPRINT_LIFECYCLE',
];

const PAGE_LIMIT = 30;

export function NotificationsView({ workspaceSlug }: Props) {
  const t = useTranslations('notifications');
  const { isDemo } = useWorkspaceRole();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [type, setType] = useState<NotificationEventType | undefined>(undefined);
  const query = useNotifications({
    workspaceSlug,
    unreadOnly,
    type,
    pageLimit: PAGE_LIMIT,
    enabled: !isDemo,
  });
  const markRead = useMarkRead(workspaceSlug);
  const markAllRead = useMarkAllRead(workspaceSlug);
  const unread = useUnreadCount(workspaceSlug, !isDemo);

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          {t('page.unreadOnly')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('page.typeFilter')}:</span>
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={type ?? ''}
            onChange={(e) =>
              setType(e.target.value ? (e.target.value as NotificationEventType) : undefined)
            }
          >
            <option value="">{t('page.allTypes')}</option>
            {EVENT_TYPES.map((eventType) => (
              <option key={eventType} value={eventType}>
                {t(`event.${eventType}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('bell.unreadBadge', { count: unread.data?.count ?? 0 })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending || (unread.data?.count ?? 0) === 0}
          >
            {t('page.markAllRead')}
          </Button>
        </div>
      </div>
      <div className="rounded-md border border-border">
        <NotificationList
          items={items}
          isLoading={query.isLoading}
          isError={query.isError}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          onMarkRead={(id) => markRead.mutate({ id })}
          onRetry={() => void query.refetch()}
          emptyMessage={t('page.empty')}
        />
      </div>
    </div>
  );
}
