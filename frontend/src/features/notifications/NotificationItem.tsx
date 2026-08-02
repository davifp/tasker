'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { NotificationItem as NotificationRecord } from '@/lib/http/notifications';

interface Props {
  notification: NotificationRecord;
  onMarkRead?: (id: string) => void;
  href?: string;
}

// Bell + list share this row. `href` is optional — the row is a
// button-styled link when a URL is supplied and a plain `<article>`
// otherwise (Task 8.0 wires the source-URL resolver).
export function NotificationItem({ notification, onMarkRead, href }: Props) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );
  const unread = !notification.readAt;
  const actorName =
    typeof notification.payload?.actorDisplayName === 'string'
      ? notification.payload.actorDisplayName
      : (notification.actorUserId ?? '—');
  const eventLine = t(`event.${notification.eventType}`);
  const taskTitle =
    typeof notification.payload?.taskTitle === 'string' ? notification.payload.taskTitle : null;
  const absoluteDate = dateFormatter.format(new Date(notification.createdAt));

  const body = (
    <div className="flex flex-1 items-start gap-2">
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          unread ? 'bg-primary' : 'bg-transparent',
        )}
      />
      <div className="flex flex-1 flex-col text-xs">
        <span className="text-foreground">
          <span className="font-medium">{actorName}</span> {eventLine}
        </span>
        {taskTitle ? <span className="mt-0.5 text-foreground/80">{taskTitle}</span> : null}
        <span className="text-[10px] text-muted-foreground" title={absoluteDate}>
          {absoluteDate}
        </span>
      </div>
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        className={cn(
          'flex items-start gap-2 rounded-sm px-2 py-2 outline-none focus-visible:bg-muted hover:bg-muted',
          unread ? 'bg-muted/40' : undefined,
        )}
        onClick={() => onMarkRead?.(notification.id)}
        aria-current={unread ? undefined : 'true'}
      >
        {body}
      </a>
    );
  }
  return (
    <article
      className={cn(
        'flex items-start gap-2 rounded-sm px-2 py-2',
        unread ? 'bg-muted/40' : undefined,
      )}
      onFocus={() => onMarkRead?.(notification.id)}
    >
      {body}
    </article>
  );
}
