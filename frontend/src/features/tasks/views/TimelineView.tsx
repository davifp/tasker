'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Task, WorkspaceRole } from '@/lib/http/types';
import { useProjectTasks } from '../hooks/useProjectTasks';
import { useProjectFilters, toTaskFilters } from '../useProjectFilters';
import { useViewPreferences } from '../hooks/useViewPreferences';
import { TaskDrawer } from '../TaskDrawer';
import { PriorityChip } from '../PriorityChip';
import { AssigneeBubble } from '../AssigneeBubble';
import { DueDatePill } from '../DueDatePill';
import { TimelineBar } from './TimelineBar';
import {
  buildAxisCells,
  partitionTasks,
  resolveWindow,
  type WindowWeeks,
} from './timeline-geometry';

interface TimelineViewProps {
  workspaceSlug: string;
  workspaceId: string;
  projectSlug: string;
  projectId: string;
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  initialTaskNumber?: number;
}

const WINDOW_PARAM = 'window';
const DEFAULT_WINDOW: WindowWeeks = 2;
const WINDOW_OPTIONS: readonly WindowWeeks[] = [2, 4];

function parseWindowParam(raw: string | null): WindowWeeks {
  if (raw === '4') return 4;
  if (raw === '2') return 2;
  return DEFAULT_WINDOW;
}

function TimelineSkeleton() {
  const t = useTranslations('timeline');
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-[240px] w-full" />
    </div>
  );
}

interface WindowToggleProps {
  value: WindowWeeks;
  onChange(next: WindowWeeks): void;
}

// Segmented control for the visible window width. Renders as two
// `role="radio"` buttons under a `role="radiogroup"` so keyboard users
// can arrow between options; state persists via URL so refresh keeps
// the choice.
function WindowToggle({ value, onChange }: WindowToggleProps) {
  const t = useTranslations('timeline.window');
  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-0.5"
      data-testid="timeline-window-toggle"
    >
      {WINDOW_OPTIONS.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(option === 2 ? 'twoWeeks' : 'fourWeeks')}
            onClick={() => onChange(option)}
            className={cn(
              'rounded-sm px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-testid={`timeline-window-${option}w`}
            data-active={active || undefined}
          >
            {t(option === 2 ? 'twoWeeks' : 'fourWeeks')}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  const t = useTranslations('timeline.empty');
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-10 text-center"
      role="status"
      data-testid="timeline-empty"
    >
      <p className="text-sm font-medium text-foreground">{t('title')}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t('body')}</p>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        {t('clear')}
      </Button>
    </div>
  );
}

/**
 * Read-only Timeline view — CSS-grid swimlanes (no chart library) with
 * absolute-positioned bars per task. The visible window is a rolling
 * 2- or 4-week span anchored at the ISO-week Monday containing today.
 *
 * Cache invariant: fetches the same `useProjectTasks(...)` shape peer
 * views use — NO `from`/`to` injection. Geometry clipping happens
 * client-side over the shared TanStack Query cache entry so switching
 * between Kanban / List / Backlog / Calendar / Timeline for the same
 * filter set costs zero extra requests.
 *
 * Window toggle: read from `?window=2|4` (default 2) so refresh
 * survives; local state mirrors it for immediate UI feedback. Task 8.0
 * will migrate this to the durable per-user, per-project
 * `useViewPreferences` module.
 */
export function TimelineView({
  workspaceSlug,
  workspaceId,
  projectSlug,
  projectId,
  currentUserId,
  currentUserRole,
  initialTaskNumber,
}: TimelineViewProps) {
  const t = useTranslations('timeline');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectFilters = useProjectFilters();
  const { filters, clear } = projectFilters;

  // MATCH peer views' filter shape exactly — the window toggle is NOT
  // part of the wire filter set. Do NOT inject a `from`/`to` derived
  // from the visible window; that would fork the shared cache entry
  // and break the "one cache entry per filter set" invariant.
  const listFilters = useMemo(
    () => toTaskFilters(filters, currentUserId),
    [filters, currentUserId],
  );

  const { data, isLoading, isError } = useProjectTasks(
    workspaceSlug,
    projectSlug,
    listFilters,
    { limit: 100 },
  );

  const tasks: readonly Task[] = useMemo(() => data?.items ?? [], [data?.items]);

  // Precedence: URL `?window=` (explicit deep link) > durable per-user
  // pref > DEFAULT_WINDOW. Local state mirrors the resolved value so the
  // toggle repaints synchronously without waiting on router.replace.
  const { preferences: durable, set: setDurable } = useViewPreferences(
    workspaceSlug,
    projectSlug,
  );
  const urlWindowRaw = searchParams?.get(WINDOW_PARAM) ?? null;
  const durableWindow = durable.timeline?.windowWeeks ?? null;
  const [windowWeeks, setWindowWeeks] = useState<WindowWeeks>(() =>
    urlWindowRaw !== null
      ? parseWindowParam(urlWindowRaw)
      : (durableWindow ?? DEFAULT_WINDOW),
  );

  // Reflect external URL edits (deep link, browser back) into local
  // state. Never write back — writes go through `handleWindowChange`.
  useEffect(() => {
    if (urlWindowRaw !== null) {
      const parsed = parseWindowParam(urlWindowRaw);
      setWindowWeeks((current) => (current === parsed ? current : parsed));
    }
  }, [urlWindowRaw]);

  // When the server pref arrives (or a peer tab pushes an update) and
  // the URL doesn't pin a window, hydrate from the durable slot.
  useEffect(() => {
    if (urlWindowRaw !== null || durableWindow === null) return;
    setWindowWeeks((current) => (current === durableWindow ? current : durableWindow));
  }, [durableWindow, urlWindowRaw]);

  const handleWindowChange = useCallback(
    (next: WindowWeeks) => {
      setWindowWeeks(next);
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (next === DEFAULT_WINDOW) {
        params.delete(WINDOW_PARAM);
      } else {
        params.set(WINDOW_PARAM, String(next));
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : (pathname ?? '/'), {
        scroll: false,
      });
      // Also persist so a hard refresh with no `?window=` remembers the
      // choice. The debounced writer coalesces a rapid double-toggle.
      setDurable({ timeline: { windowWeeks: next } });
    },
    [pathname, router, searchParams, setDurable],
  );

  // Captured at mount / toggle; does not roll at midnight. Reviewed and accepted.
  const visibleWindow = useMemo(
    () => resolveWindow(new Date(), windowWeeks),
    [windowWeeks],
  );

  const axisCells = useMemo(() => buildAxisCells(visibleWindow), [visibleWindow]);

  const { dated, undated, outsideWindow } = useMemo(
    () => partitionTasks(tasks, visibleWindow),
    [tasks, visibleWindow],
  );

  const [openTaskNumber, setOpenTaskNumber] = useState<number | null>(
    initialTaskNumber ?? null,
  );

  useEffect(() => {
    if (initialTaskNumber !== undefined) setOpenTaskNumber(initialTaskNumber);
  }, [initialTaskNumber]);

  const handleOpen = useCallback((taskNumber: number) => {
    setOpenTaskNumber(taskNumber);
  }, []);

  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const monthFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    [locale],
  );

  if (isLoading && tasks.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-end">
          <WindowToggle value={windowWeeks} onChange={handleWindowChange} />
        </div>
        <TimelineSkeleton />
      </div>
    );
  }
  if (isError) {
    return (
      <div
        className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
        data-testid="timeline-error"
      >
        {t('errorLoad')}
      </div>
    );
  }

  const totalDays = axisCells.length;
  const hasBars = dated.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="timeline-range">
          {monthFormatter.format(visibleWindow.start)} –{' '}
          {monthFormatter.format(
            new Date(visibleWindow.end.getTime() - 24 * 60 * 60 * 1000),
          )}
        </p>
        <WindowToggle value={windowWeeks} onChange={handleWindowChange} />
      </div>

      <div
        className="overflow-hidden rounded-lg border border-border bg-background"
        data-testid="timeline-view"
        data-window-weeks={windowWeeks}
      >
        {/* Axis header — one cell per day. Uses CSS grid so the parent
            width is split evenly and the bar row's absolute layer aligns
            perfectly with the day columns. */}
        <div
          className="grid border-b border-border bg-muted/40 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(${totalDays}, minmax(0, 1fr))` }}
          role="row"
          data-testid="timeline-axis"
        >
          {axisCells.map((cell) => (
            <div
              key={cell.dayIndex}
              className={cn(
                'px-1 py-1 text-center',
                cell.isWeekStart && 'border-l border-border',
              )}
              data-day-index={cell.dayIndex}
              data-week-start={cell.isWeekStart || undefined}
            >
              {dayFormatter.format(cell.date)}
            </div>
          ))}
        </div>

        {/* Swimlane rows — one per bar for now. Task 9.0 evaluates
            grouping (by assignee or status) once virtualization
            requirements are measured. Each row is a positioned
            container the absolute bar drapes over. */}
        {hasBars ? (
          <ul
            className="flex flex-col"
            data-testid="timeline-lanes"
            aria-label={t('lanes.label')}
          >
            {dated.map(({ task, geometry }, index) => (
              <li
                key={task.id}
                className={cn(
                  'relative h-9 border-t border-border/60 first:border-t-0',
                  index % 2 === 1 && 'bg-muted/20',
                )}
                data-testid={`timeline-lane-${task.number}`}
              >
                {/* Day grid overlay — faint vertical rules at week
                    starts to reinforce the week rhythm without competing
                    with the bar. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 grid"
                  style={{
                    gridTemplateColumns: `repeat(${totalDays}, minmax(0, 1fr))`,
                  }}
                >
                  {axisCells.map((cell) => (
                    <div
                      key={cell.dayIndex}
                      className={cn(
                        cell.isWeekStart && 'border-l border-border/40',
                      )}
                    />
                  ))}
                </div>
                <TimelineBar
                  task={task}
                  geometry={geometry}
                  onOpen={handleOpen}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="p-6 text-center text-sm text-muted-foreground"
            data-testid="timeline-lanes-empty"
          >
            {t('lanes.empty')}
          </div>
        )}
      </div>

      <OutsideWindowChip count={outsideWindow.length} />

      <NoDatesSection tasks={undated} onOpen={handleOpen} />

      {!hasBars && undated.length === 0 && outsideWindow.length === 0 ? (
        <EmptyState onClear={clear} />
      ) : null}

      <TaskDrawer
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        projectSlug={projectSlug}
        projectId={projectId}
        taskNumber={openTaskNumber}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        focusTitleOnMount={initialTaskNumber !== undefined}
        onClose={() => setOpenTaskNumber(null)}
        onDelete={() => setOpenTaskNumber(null)}
      />
    </div>
  );
}

// Compact count-only chip surfaced near the "No dates" section: shows
// how many tasks have both dates set but fall FULLY outside the visible
// window. Semantically distinct from `NoDatesSection` (which is for
// tasks lacking an endpoint). Hidden when the count is zero.
function OutsideWindowChip({ count }: { count: number }) {
  const t = useTranslations('timeline.outsideWindow');
  if (count === 0) return null;
  return (
    <div
      className="inline-flex w-fit items-center rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground"
      data-testid="timeline-outside-window"
      data-count={count}
      role="status"
    >
      {t('count', { count })}
    </div>
  );
}

interface NoDatesSectionProps {
  tasks: readonly Task[];
  onOpen(taskNumber: number): void;
}

// Beneath the chart: tasks missing `startDate`, `dueDate`, or both.
// Dated tasks whose interval falls fully outside the window surface via
// `OutsideWindowChip` instead — keeping this list semantically pure.
function NoDatesSection({ tasks, onOpen }: NoDatesSectionProps) {
  const t = useTranslations('timeline.noDates');
  if (tasks.length === 0) return null;
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
      data-testid="timeline-no-dates"
      aria-label={t('title')}
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-foreground">{t('title')}</h2>
        <span className="text-xs text-muted-foreground">
          {t('count', { count: tasks.length })}
        </span>
      </header>
      <ul className="flex flex-col divide-y divide-border/60">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onOpen(task.number)}
              className="flex w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`timeline-no-dates-task-${task.number}`}
            >
              <span className="flex-1 truncate text-sm text-foreground">
                {task.title}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <PriorityChip priority={task.priority} />
                <AssigneeBubble userId={task.assigneeUserId} />
                {task.dueDate ? <DueDatePill dueDate={task.dueDate} /> : null}
                <span className="w-10 text-right text-[10px] font-medium text-muted-foreground">
                  #{task.number}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
