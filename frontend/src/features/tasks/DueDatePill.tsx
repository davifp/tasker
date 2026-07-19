import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DueDatePillProps {
  dueDate: string;
  now?: Date;
  className?: string;
}

function isOverdue(dueDate: string, now: Date): boolean {
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return false;
  return due < now.getTime();
}

export function DueDatePill({ dueDate, now = new Date(), className }: DueDatePillProps) {
  const locale = useLocale();
  const t = useTranslations('board.dueDate');
  const overdue = isOverdue(dueDate, now);
  const formatted = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(dueDate),
  );
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        overdue
          ? 'bg-red-500/15 text-red-700 dark:text-red-300'
          : 'bg-muted text-muted-foreground',
        className,
      )}
      aria-label={overdue ? t('overdueLabel', { date: formatted }) : t('label', { date: formatted })}
    >
      <CalendarClock className="h-3 w-3" aria-hidden="true" />
      {formatted}
    </span>
  );
}
