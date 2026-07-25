'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { REACTIONS_GLYPHS, type ReactionEmoji } from '@tasker/config';
import { Button } from '@/components/ui/button';
import { AssigneeBubble } from '@/features/tasks/AssigneeBubble';
import type { Activity } from '@/lib/http/types';
import { useTaskActivity } from './useTaskActivity';

interface ActivityFeedProps {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
}

/**
 * Chronological (newest-first) feed of activity rows for a single task.
 * Uses the shared verb catalog from @tasker/config -- unknown verbs render
 * as their raw string so a backend addition never crashes the drawer.
 *
 * Each entry blends the actor avatar, a verb-driven line, and the relative
 * timestamp. Payload placeholders (`{from}`, `{to}`, `{emoji}`,
 * `{filename}`) are pulled from `activity.payload` when present.
 */
export function ActivityFeed({ workspaceSlug, projectSlug, taskNumber }: ActivityFeedProps) {
  const t = useTranslations('board.activity');
  const locale = useLocale();
  const query = useTaskActivity({ workspaceSlug, projectSlug, taskNumber });

  const rows = useMemo<Activity[]>(() => {
    if (!query.data) return [];
    return query.data.pages.flatMap((page) => page.items);
  }, [query.data]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  return (
    <section className="flex flex-col gap-2" aria-label={t('label')}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('heading')}
      </h4>
      {query.isLoading && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((activity) => (
            <li key={activity.id} className="flex items-start gap-2">
              {activity.actorUserId ? (
                <AssigneeBubble userId={activity.actorUserId} size="sm" />
              ) : (
                <div className="h-6 w-6" aria-hidden="true" />
              )}
              <div className="flex flex-1 flex-col text-xs">
                <span className="text-foreground">
                  <span className="font-medium">
                    {activity.payload.actorDisplayName ?? activity.actorUserId ?? '—'}
                  </span>{' '}
                  {renderVerb(activity, t)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {dateFormatter.format(new Date(activity.createdAt))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function renderVerb(activity: Activity, t: ReturnType<typeof useTranslations>): string {
  const values: Record<string, string> = {};
  if (activity.payload.from) values.from = activity.payload.from;
  if (activity.payload.to) values.to = activity.payload.to;
  if (activity.payload.emoji) {
    const emoji = activity.payload.emoji as ReactionEmoji;
    values.emoji = REACTIONS_GLYPHS[emoji] ?? activity.payload.emoji;
  }
  if (activity.payload.attachmentFilename) values.filename = activity.payload.attachmentFilename;
  try {
    return t(`verbs.${activity.verb}`, values);
  } catch {
    return activity.verb;
  }
}
