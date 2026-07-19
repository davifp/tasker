import { useTranslations } from 'next-intl';
import type { Priority } from '@/lib/http/types';
import { cn } from '@/lib/utils';

interface PriorityChipProps {
  priority: Priority;
  className?: string;
}

// Solid, WCAG-AA-safe pairs. The semi-transparent originals were flagged
// by axe (light-mode text-amber-700 over an amber-500/15 bg blended into
// the page background gives < 4.5:1). These solid tones stay legible in
// both themes.
const styles: Record<Priority, string> = {
  LOW: 'bg-muted text-muted-foreground',
  MEDIUM: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  HIGH: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
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
