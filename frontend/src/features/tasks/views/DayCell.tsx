'use client';

import { useTranslations } from 'next-intl';
import { DayButton, useDayPicker, type DayButtonProps } from 'react-day-picker';
import { formatInTimeZone } from 'date-fns-tz';
import type { Locale } from 'date-fns';
import type { Task } from '@/lib/http/types';
import { cn } from '@/lib/utils';
import { bucketKeyForDayDate, type DayBucketKey } from './tz-bucketing';

// Data the calendar hands each cell so it can render badges without
// re-doing the bucketing work. Passed via the `DayPicker`
// `components.DayButton` closure, not props on this component (v9
// doesn't expose an escape hatch to pass extra props into the slot).
export interface DayCellDatum {
  tasks: readonly Task[];
}

interface DayCellFactoryArgs {
  bucketsByKey: ReadonlyMap<DayBucketKey, readonly Task[]>;
  onSelectDay: (dayKey: DayBucketKey, date: Date) => void;
  workspaceTimezone: string;
  dateFnsLocale: Locale;
}

// Factory: returns a DayButton override closed over the current buckets
// and the day-select handler. react-day-picker instantiates the
// component per cell, so we cannot pass props directly — but a factory
// bound at render time gives each render its own view of the buckets.
export function makeDayCell({
  bucketsByKey,
  onSelectDay,
  workspaceTimezone,
  dateFnsLocale,
}: DayCellFactoryArgs) {
  return function DayCell(props: DayButtonProps) {
    return (
      <DayCellInner
        buttonProps={props}
        bucketsByKey={bucketsByKey}
        onSelectDay={onSelectDay}
        workspaceTimezone={workspaceTimezone}
        dateFnsLocale={dateFnsLocale}
      />
    );
  };
}

interface DayCellInnerProps {
  buttonProps: DayButtonProps;
  bucketsByKey: ReadonlyMap<DayBucketKey, readonly Task[]>;
  onSelectDay: (dayKey: DayBucketKey, date: Date) => void;
  workspaceTimezone: string;
  dateFnsLocale: Locale;
}

function DayCellInner({
  buttonProps,
  bucketsByKey,
  onSelectDay,
  workspaceTimezone,
  dateFnsLocale,
}: DayCellInnerProps) {
  const t = useTranslations('calendar.day');
  const { classNames } = useDayPicker();
  const { day, modifiers } = buttonProps;
  const key = bucketKeyForDayDate(day.date);
  const tasks = bucketsByKey.get(key) ?? [];
  const count = tasks.length;
  const preview = tasks[0]?.title ?? null;
  const isOutside = Boolean(modifiers.outside);

  // Compose an accessible label — number of tasks + preview of the
  // first title. Screen readers get the full context; sighted users
  // see the compact badge + one-line preview. Uses locale-aware
  // long-date formatting so pt-BR announces "15 de julho de 2026"
  // instead of the en-US-only `Date#toDateString`.
  const formattedDay = formatInTimeZone(day.date, workspaceTimezone, 'PPP', {
    locale: dateFnsLocale,
  });
  const ariaLabel =
    count === 0
      ? t('empty', { date: formattedDay })
      : t('count', { count, date: formattedDay });

  return (
    <DayButton
      {...buttonProps}
      onClick={(event) => {
        buttonProps.onClick?.(event);
        onSelectDay(key, day.date);
      }}
      aria-label={ariaLabel}
      className={cn(classNames.day_button, 'group/day')}
      data-testid={`calendar-day-${key}`}
      data-day-key={key}
      data-task-count={count}
    >
      <span className="flex h-full w-full flex-col items-stretch justify-start gap-1 p-1 text-left">
        <span
          className={cn(
            'text-xs font-medium',
            isOutside ? 'text-muted-foreground/60' : 'text-foreground',
          )}
        >
          {day.date.getDate()}
        </span>
        {count > 0 ? (
          <span className="flex flex-col gap-0.5">
            <span
              className="inline-flex w-fit items-center rounded-md bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary"
              data-testid={`calendar-badge-${key}`}
            >
              {t('badge', { count })}
            </span>
            {preview ? (
              <span
                className="truncate text-[10px] text-muted-foreground"
                title={preview}
              >
                {preview}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </DayButton>
  );
}
