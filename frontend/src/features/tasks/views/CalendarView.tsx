'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, ptBR } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { getISOWeek } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Task, WorkspaceRole } from '@/lib/http/types';
import { useProjectTasks } from '../hooks/useProjectTasks';
import { useProjectFilters, toTaskFilters } from '../useProjectFilters';
import { TaskDrawer } from '../TaskDrawer';
import { makeDayCell } from './DayCell';
import { DayPanel } from './DayPanel';
import { bucketTasksByDay, type DayBucketKey } from './tz-bucketing';

// Resolve next-intl's string locale to a concrete `date-fns` Locale
// object so `<DayPicker>` and `formatInTimeZone` produce localized
// month/weekday captions and long-date strings instead of falling
// back to English.
function resolveDateFnsLocale(nextIntlLocale: string): Locale {
  return nextIntlLocale === 'pt-BR' ? ptBR : enUS;
}

interface CalendarViewProps {
  workspaceSlug: string;
  workspaceId: string;
  projectSlug: string;
  projectId: string;
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  // Workspace-configured IANA timezone (e.g. `America/Sao_Paulo`).
  // TODO(workspaces-tz): source from Workspace.timezone once the field
  // lands on the backend schema + SessionPayload. Until then the
  // server shell resolves this to `'UTC'`.
  workspaceTimezone: string;
  initialTaskNumber?: number;
}

function CalendarSkeleton() {
  const t = useTranslations('calendar');
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[320px] w-full" />
    </div>
  );
}

function EmptyMonthBanner({ onClear }: { onClear: () => void }) {
  const t = useTranslations('calendar.empty');
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center"
      role="status"
      data-testid="calendar-empty-month"
    >
      <p className="text-sm font-medium text-foreground">{t('title')}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t('body')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClear}
        data-testid="calendar-empty-clear"
      >
        {t('clear')}
      </Button>
    </div>
  );
}

/**
 * Calendar view — month grid backed by `react-day-picker` v9 with a
 * custom `DayButton` slot that renders per-day task badges and a
 * one-line preview. Selecting a day opens `DayPanel` listing the
 * day's tasks; picking a task from the panel opens the shared
 * `TaskDrawer` (same drawer Kanban / List / Backlog use).
 *
 * Cache invariant: the fetch uses the exact same filter shape the
 * peer views pass — no `from`/`to` derived from the visible month —
 * so switching to Calendar from Kanban / List / Backlog is a zero-
 * request cache hit at the `taskKeys.list` layer. Bucketing into
 * calendar days is a purely client-side transform.
 *
 * Timezone: tasks bucket by their workspace-tz calendar day, NOT the
 * browser's local zone. Two team members in different zones see the
 * same task on the same day.
 */
export function CalendarView({
  workspaceSlug,
  workspaceId,
  projectSlug,
  projectId,
  currentUserId,
  currentUserRole,
  workspaceTimezone,
  initialTaskNumber,
}: CalendarViewProps) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const dateFnsLocale = useMemo(() => resolveDateFnsLocale(locale), [locale]);
  const projectFilters = useProjectFilters();
  const { filters, clear } = projectFilters;

  // MATCH peer views' filter shape exactly. Do NOT inject
  // from/to based on the visible month — that would fork the
  // shared TanStack Query cache entry.
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

  const bucketsByKey = useMemo(
    () => bucketTasksByDay(tasks, workspaceTimezone),
    [tasks, workspaceTimezone],
  );

  const [month, setMonth] = useState<Date>(() => new Date());
  const [selectedDayKey, setSelectedDayKey] = useState<DayBucketKey | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openTaskNumber, setOpenTaskNumber] = useState<number | null>(
    initialTaskNumber ?? null,
  );
  const [liveMessage, setLiveMessage] = useState<string>('');

  useEffect(() => {
    if (initialTaskNumber !== undefined) setOpenTaskNumber(initialTaskNumber);
  }, [initialTaskNumber]);

  const handleSelectDay = useCallback(
    (dayKey: DayBucketKey, date: Date) => {
      setSelectedDayKey(dayKey);
      setSelectedDate(date);
      setPanelOpen(true);
      const count = bucketsByKey.get(dayKey)?.length ?? 0;
      // Locale-aware announcement — matches the `SheetTitle` in
      // `DayPanel` (both use `formatInTimeZone(..., 'PPP', { locale })`).
      // Screen readers hear "July 15th, 2026" in en / "15 de julho de
      // 2026" in pt-BR, not the en-US-only `Date#toDateString`.
      setLiveMessage(
        t('announce.selected', {
          date: formatInTimeZone(date, workspaceTimezone, 'PPP', {
            locale: dateFnsLocale,
          }),
          count,
        }),
      );
    },
    [bucketsByKey, dateFnsLocale, t, workspaceTimezone],
  );

  const handleOpenTask = useCallback((taskNumber: number) => {
    setOpenTaskNumber(taskNumber);
    setPanelOpen(false);
  }, []);

  // Determine whether the CURRENT filter set produced any dated task
  // whatsoever — that's how we surface the "no tasks match" empty
  // state. A per-day empty state is implicit in cells that render 0
  // tasks and no badge.
  const totalDatedTasks = useMemo(() => {
    let total = 0;
    for (const list of bucketsByKey.values()) total += list.length;
    return total;
  }, [bucketsByKey]);

  const dayCellComponent = useMemo(
    () =>
      makeDayCell({
        bucketsByKey,
        onSelectDay: handleSelectDay,
        workspaceTimezone,
        dateFnsLocale,
      }),
    [bucketsByKey, dateFnsLocale, handleSelectDay, workspaceTimezone],
  );

  const selectedTasks = useMemo(() => {
    if (!selectedDayKey) return [];
    return bucketsByKey.get(selectedDayKey) ?? [];
  }, [bucketsByKey, selectedDayKey]);

  const selectedDisplay =
    selectedDate !== null
      ? formatInTimeZone(selectedDate, workspaceTimezone, 'PPP', {
          locale: dateFnsLocale,
        })
      : null;

  // Weekly rail: group the tasks visible in the CURRENT displayed
  // month by ISO week. Uses the same buckets the grid consumes so
  // the rail can never disagree with the cells about which day a
  // task belongs on. Rows collapse to nothing when a filter set
  // has zero dated tasks in the month.
  const isoWeekGroups = useMemo(() => {
    const monthKeyPrefix = `${month.getFullYear()}-${String(
      month.getMonth() + 1,
    ).padStart(2, '0')}`;
    const byWeek = new Map<number, Task[]>();
    for (const [dayKey, list] of bucketsByKey) {
      if (!dayKey.startsWith(monthKeyPrefix)) continue;
      for (const task of list) {
        if (!task.dueDate) continue;
        // ISO week is a wall-clock concept keyed off the workspace's
        // calendar day; recompute the local Date from the bucket key
        // so cross-TZ users still land in the same week.
        const [yearStr, monthStr, dayStr] = dayKey.split('-');
        const local = new Date(
          Number(yearStr),
          Number(monthStr) - 1,
          Number(dayStr),
        );
        const week = getISOWeek(local);
        const bucket = byWeek.get(week);
        if (bucket) {
          bucket.push(task);
          continue;
        }
        byWeek.set(week, [task]);
      }
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => a - b)
      .map(([week, tasks]) => ({ week, tasks }));
  }, [bucketsByKey, month]);

  const handleOpenTaskFromRail = useCallback((taskNumber: number) => {
    setOpenTaskNumber(taskNumber);
  }, []);

  if (isLoading && tasks.length === 0) {
    return <CalendarSkeleton />;
  }
  if (isError) {
    return (
      <div
        className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
        data-testid="calendar-error"
      >
        {t('errorLoad')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite" role="status" className="sr-only">
        {liveMessage}
      </div>
      {totalDatedTasks === 0 ? <EmptyMonthBanner onClear={clear} /> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_16rem]">
      <div
        className="rounded-lg border border-border bg-background p-3"
        data-testid="calendar-view"
        data-tz={workspaceTimezone}
      >
        <DayPicker
          mode="single"
          month={month}
          onMonthChange={setMonth}
          showOutsideDays
          weekStartsOn={0}
          locale={dateFnsLocale}
          components={{ DayButton: dayCellComponent }}
          aria-label={t('caption', { locale })}
          classNames={{
            months: 'flex flex-col gap-4',
            month: 'space-y-2',
            month_caption: 'flex items-center justify-between px-2',
            caption_label: 'text-sm font-semibold text-foreground',
            nav: 'flex items-center gap-1',
            button_previous:
              'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            button_next:
              'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            month_grid: 'w-full border-collapse',
            weekdays: 'text-[10px] font-medium uppercase text-muted-foreground',
            weekday: 'p-1 text-center',
            week: 'grid grid-cols-7',
            day: 'align-top',
            day_button:
              'flex h-20 w-full flex-col items-stretch justify-start rounded-md border border-transparent bg-transparent p-0 text-left hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            today: 'ring-1 ring-primary/40',
            outside: 'opacity-60',
          }}
        />
      </div>
        <aside
          className="rounded-lg border border-border bg-background p-3"
          aria-label={t('weeklyRail.title')}
          data-testid="calendar-weekly-rail"
        >
          <h2 className="text-sm font-medium text-foreground">
            {t('weeklyRail.title')}
          </h2>
          {isoWeekGroups.length === 0 ? (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="calendar-weekly-rail-empty"
            >
              {t('weeklyRail.empty')}
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-3">
              {isoWeekGroups.map(({ week, tasks: weekTasks }) => (
                <div key={week} data-testid={`calendar-weekly-rail-week-${week}`}>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('weeklyRail.week', { week })}
                  </h3>
                  <ul className="mt-1 flex flex-col gap-1">
                    {weekTasks.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => handleOpenTaskFromRail(task.number)}
                          className="w-full truncate rounded-sm px-1 py-0.5 text-left text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          data-testid={`calendar-weekly-rail-task-${task.number}`}
                        >
                          {task.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
      <DayPanel
        displayDate={selectedDisplay}
        tasks={selectedTasks}
        open={panelOpen}
        onOpenChange={(next) => setPanelOpen(next)}
        onOpenTask={handleOpenTask}
      />
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
