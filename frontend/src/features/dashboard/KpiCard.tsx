import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  /** Optional trend indicator: `up` / `down` / `flat`. */
  trend?: 'up' | 'down' | 'flat';
  /** Optional accessible-name hint for the trend (icon-only otherwise). */
  trendLabel?: string;
  children?: React.ReactNode;
}

/**
 * KPI cell with an optional trend arrow. Trend colour + icon + optional
 * label are all present — never colour alone (PRD accessibility).
 */
export function KpiCard({
  label,
  value,
  unit,
  trend,
  trendLabel,
  children,
}: KpiCardProps): React.JSX.Element {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : ArrowRight;
  return (
    <article className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <header className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {children}
      </header>
      <p className="flex items-baseline gap-2 text-2xl font-semibold text-foreground">
        <span>{value}</span>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </p>
      {trend ? (
        <p
          className={cn(
            'inline-flex items-center gap-1 text-xs',
            trend === 'up' && 'text-emerald-600',
            trend === 'down' && 'text-destructive',
            trend === 'flat' && 'text-muted-foreground',
          )}
          aria-label={trendLabel}
        >
          <TrendIcon className="h-3 w-3" aria-hidden />
          <span className="sr-only">{trendLabel ?? trend}</span>
        </p>
      ) : null}
    </article>
  );
}
