'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NotificationList } from './NotificationList';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from './hooks/useNotifications';
import { useWorkspaceRole } from '@/features/workspace/context/WorkspaceRoleContext';

interface Props {
  workspaceSlug: string;
}

const BELL_PAGE_LIMIT = 10;

export function NotificationBell({ workspaceSlug }: Props) {
  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const { isDemo } = useWorkspaceRole();
  const unread = useUnreadCount(workspaceSlug, !isDemo);
  const list = useNotifications({
    workspaceSlug,
    pageLimit: BELL_PAGE_LIMIT,
    enabled: open && !isDemo,
  });
  const markRead = useMarkRead(workspaceSlug);
  const markAllRead = useMarkAllRead(workspaceSlug);

  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const unreadCount = unread.data?.count ?? 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0
              ? `${t('bell.label')} — ${t('bell.unreadBadge', { count: unreadCount })}`
              : t('bell.label')
          }
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 ? (
            <Badge
              className="absolute -right-1 -top-1 h-4 min-w-4 items-center justify-center rounded-full p-0 px-1 text-[10px]"
              variant="destructive"
              aria-hidden="true"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <DropdownMenuLabel className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-sm font-semibold">{t('bell.label')}</span>
          {unreadCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              {t('bell.markAllRead')}
            </Button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-80 overflow-y-auto">
          <NotificationList
            items={items}
            isLoading={list.isLoading}
            isError={list.isError}
            onMarkRead={(id) => markRead.mutate({ id })}
            onRetry={() => void list.refetch()}
          />
        </div>
        <DropdownMenuSeparator className="m-0" />
        <Link
          href={`/${workspaceSlug}/notifications`}
          className="block px-3 py-2 text-center text-xs font-medium text-primary hover:underline"
        >
          {t('bell.viewAll')}
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
