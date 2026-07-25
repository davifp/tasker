import type { FiscalYearOffsetMonths } from './roadmap';

export interface QuarterFromDateOptions {
  /**
   * Number of whole months the fiscal year is shifted from January. 0 means
   * the fiscal year starts in January; 3 means April; 6 means July; 9 means
   * October. Restricted to 3-month multiples to keep quarter boundaries on
   * month boundaries (see `FISCAL_YEAR_OFFSETS_MONTHS`).
   */
  fiscalYearOffsetMonths: FiscalYearOffsetMonths;
}

/**
 * Maps a `Date` to a `YYYY-Qn` quarter identifier under the workspace's
 * fiscal-year convention.
 *
 * Convention: the fiscal year is labeled by its **starting calendar year**.
 * With `fiscalYearOffsetMonths = 3` (fiscal year starts April), a date in
 * April 2026 lands in `2026-Q1` and a date in March 2026 lands in `2025-Q4`.
 *
 * All arithmetic uses UTC accessors so the result is stable regardless of
 * the process timezone. Callers that need workspace-local semantics should
 * shift `date` into workspace time before calling this helper (the backend
 * `WorkspaceContext.timezone` is the canonical source for that shift).
 */
export function quarterFromDate(date: Date, opts: QuarterFromDateOptions): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('quarterFromDate: `date` must be a valid Date');
  }

  const offset = opts.fiscalYearOffsetMonths;

  // Month in [0, 11], UTC-based to keep the result timezone-independent.
  const calendarMonth = date.getUTCMonth();
  const calendarYear = date.getUTCFullYear();

  // Shift the calendar month backwards by `offset` so month 0 always aligns
  // with the start of the fiscal year. `+ 12` guards the negative case.
  const fiscalMonth = (calendarMonth - offset + 12) % 12;
  const quarter = Math.floor(fiscalMonth / 3) + 1;

  // Fiscal-year label: the starting calendar year. If the calendar month is
  // before the fiscal-year start, we are still in the *previous* fiscal year.
  const fiscalYear = calendarMonth >= offset ? calendarYear : calendarYear - 1;

  return `${fiscalYear}-Q${quarter}`;
}
