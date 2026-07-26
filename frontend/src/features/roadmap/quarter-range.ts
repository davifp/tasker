import type { FiscalYearOffsetMonths } from '@tasker/config';
import { quarterFromDate } from '@tasker/config';

/**
 * Pure quarter-range helpers used by the roadmap grid + the drag "snap"
 * math. Kept separate from the component so the math is unit-testable
 * without React.
 */

export interface QuarterId {
  year: number;
  q: 1 | 2 | 3 | 4;
}

/**
 * Parses `YYYY-Qn` into its structured form. Throws on malformed input —
 * every caller either receives the id from `@tasker/config` or from the
 * backend, both of which are schema-validated upstream.
 */
export function parseQuarterId(id: string): QuarterId {
  const match = /^(\d{4})-Q([1-4])$/.exec(id);
  if (!match) throw new Error(`Malformed quarter id: ${id}`);
  return { year: Number(match[1]), q: Number(match[2]) as 1 | 2 | 3 | 4 };
}

export function formatQuarterId({ year, q }: QuarterId): string {
  return `${year}-Q${q}`;
}

/**
 * Ordinal position along the timeline. Used to compare or diff quarters
 * without unpacking the year/quarter parts.
 */
export function quarterOrdinal(id: string): number {
  const { year, q } = parseQuarterId(id);
  return year * 4 + q;
}

/**
 * Returns the sequence of quarter ids covering `[from, to]` inclusive.
 * Used by the roadmap grid to render one column per quarter.
 */
export function quarterRange(from: string, to: string): string[] {
  const fromOrd = quarterOrdinal(from);
  const toOrd = quarterOrdinal(to);
  if (toOrd < fromOrd) return [];
  const out: string[] = [];
  for (let ord = fromOrd; ord <= toOrd; ord++) {
    const year = Math.floor((ord - 1) / 4);
    const q = (((ord - 1) % 4) + 1) as 1 | 2 | 3 | 4;
    out.push(formatQuarterId({ year, q }));
  }
  return out;
}

/**
 * Shifts a quarter id by `delta` quarters. Negative deltas move backwards.
 */
export function shiftQuarter(id: string, delta: number): string {
  const ord = quarterOrdinal(id) + delta;
  const year = Math.floor((ord - 1) / 4);
  const q = (((ord - 1) % 4) + 1) as 1 | 2 | 3 | 4;
  return formatQuarterId({ year, q });
}

/**
 * Renders the visible horizon: the fiscal quarter containing `today`
 * plus `lookaheadQuarters` following quarters. Uses the shared
 * `quarterFromDate` so the horizon matches the metrics module's windowing.
 */
export function visibleHorizon(
  today: Date,
  offsetMonths: FiscalYearOffsetMonths,
  lookaheadQuarters: number,
): string[] {
  const start = quarterFromDate(today, { fiscalYearOffsetMonths: offsetMonths });
  const end = shiftQuarter(start, Math.max(0, lookaheadQuarters));
  return quarterRange(start, end);
}
