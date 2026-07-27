'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { NotificationItem } from './NotificationItem';
import type { NotificationItem as NotificationRecord } from '@/lib/http/notifications';

interface Props {
  items: NotificationRecord[];
  isLoading?: boolean;
  isError?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  onMarkRead?: (id: string) => void;
  onRetry?: () => void;
  emptyMessage?: string;
  hrefFor?: (item: NotificationRecord) => string | undefined;
}

// Shared list surface used by both the bell dropdown and the full
// `/notifications` page. The parent owns paging + filters; this component
// just renders and defers actions upward.
export function NotificationList({
  items,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onMarkRead,
  onRetry,
  emptyMessage,
  hrefFor,
}: Props) {
  const t = useTranslations('notifications');

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-xs text-muted-foreground">{t('bell.error')}</p>
        {onRetry ? (
          <Button size="sm" variant="ghost" onClick={onRetry}>
            {t('bell.retry')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (isLoading && items.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-xs text-muted-foreground">
        {emptyMessage ?? t('bell.empty')}
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col" aria-live="polite">
        {items.map((notification) => (
          <li key={notification.id}>
            <NotificationItem
              notification={notification}
              onMarkRead={onMarkRead}
              href={hrefFor?.(notification)}
            />
          </li>
        ))}
      </ul>
      {hasNextPage ? (
        <div className="flex justify-center py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? t('page.loadingMore') : t('page.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
