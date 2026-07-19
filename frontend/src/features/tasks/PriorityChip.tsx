import { useTranslations } from 'next-intl';
import type { Priority } from '@/lib/http/types';
import { cn } from '@/lib/utils';

interface PriorityChipProps {
  priority: Priority;
  className?: string;
}

const styles: Record<Priority, string> = {
  LOW: 'bg-muted text-muted-foreground',
  MEDIUM: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  HIGH: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

export function PriorityChip({ priority, className }: PriorityChipProps) {
  const t = useTranslations('board.priority');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        styles[priority],
        className,
      )}
      aria-label={t('label', { priority: t(`values.${priority}`) })}
    >
      {t(`values.${priority}`)}
    </span>
  );
}
