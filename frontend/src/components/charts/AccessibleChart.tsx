'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface AccessibleSeriesPoint {
  label: string;
  value: number;
}

export interface AccessibleChartProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Human-readable, context-full name announced to assistive tech.
   * Example: `"Burndown for Sprint 42 — 10 days of planned vs remaining points"`.
   */
  ariaLabel: string;
  /**
   * Optional pre-formatted description that overrides the auto-generated
   * text alternative. Passing an empty string suppresses the alternative
   * — useful when the surrounding UI already exposes the same numbers.
   */
  description?: string;
  /**
   * Data used by the auto-generated text alternative when `description` is
   * absent. Kept as a plain shape so consumers can build it from any
   * charting library without coupling.
   */
  data?: AccessibleSeriesPoint[];
  /**
   * Optional units string (e.g. `points`, `hours`). Appended to numbers in
   * the auto-generated summary.
   */
  units?: string;
  children: React.ReactNode;
}

/**
 * Wraps a Recharts (or any SVG) chart with the accessibility affordances
 * every planning-dashboard chart owes an assistive-tech user:
 *
 *   - `role="img"` and a caller-supplied `aria-label` — the chart becomes
 *     an announcable image node in the a11y tree.
 *   - A visually hidden `<div role="note">` with the auto-generated (or
 *     caller-supplied) text alternative, so screen readers announce the
 *     narrative that sighted users see in the chart.
 *
 * The wrapper does NOT force a specific chart library: pass a Recharts
 * `<ResponsiveContainer>` (or plain `<svg>`) as `children`.
 */
export function AccessibleChart({
  ariaLabel,
  description,
  data,
  units,
  className,
  children,
  ...rest
}: AccessibleChartProps): React.JSX.Element {
  const summary = description ?? buildSummary(data, units);
  return (
    <div role="img" aria-label={ariaLabel} className={cn('relative', className)} {...rest}>
      {children}
      {summary ? (
        <div className="sr-only" role="note">
          {summary}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Builds a concise, verb-led one-sentence summary suitable for a screen
 * reader. Rules:
 *   - No data → empty string (caller should provide a fallback aria-label).
 *   - Single point → `"<label>: <value> <units>"`.
 *   - Multi-point → `"<n> points from <first> to <last>. Min <min>, max <max>, average <avg>."`.
 */
export function buildSummary(
  data: AccessibleSeriesPoint[] | undefined,
  units: string | undefined,
): string {
  if (!data || data.length === 0) return '';
  const unit = units ? ` ${units}` : '';
  if (data.length === 1) {
    const only = data[0]!;
    return `${only.label}: ${formatNumber(only.value)}${unit}.`;
  }
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const first = data[0]!;
  const last = data[data.length - 1]!;
  return (
    `${data.length} points from ${first.label} to ${last.label}. ` +
    `Min ${formatNumber(min)}${unit}, ` +
    `max ${formatNumber(max)}${unit}, ` +
    `average ${formatNumber(avg)}${unit}.`
  );
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
