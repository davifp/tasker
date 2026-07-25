/**
 * Roadmap and fiscal-year config shared by the backend `epics` module and
 * the frontend roadmap board. Quarter arithmetic is workspace-scoped: the
 * fiscal-year offset shifts every quarter boundary by whole months from the
 * calendar year.
 */

/**
 * Allowed fiscal-year offsets in months. Restricting to 3-month multiples
 * matches the quarterly grain of the roadmap (a non-multiple would put a
 * quarter boundary in the middle of a month, which no downstream consumer
 * handles).
 */
export const FISCAL_YEAR_OFFSETS_MONTHS = [0, 3, 6, 9] as const;

export type FiscalYearOffsetMonths = (typeof FISCAL_YEAR_OFFSETS_MONTHS)[number];

export const FISCAL_YEAR_OFFSET_DEFAULT: FiscalYearOffsetMonths = 0;

/**
 * PRD FR-23: the roadmap MUST render the current fiscal year plus the next
 * four quarters. That means the visible horizon is 4 + 4 = 8 quarters at
 * offset 0. `MIN_QUARTERS` and `MAX_QUARTERS` bound API queries to prevent
 * abuse and keep the client render cheap.
 */
export const ROADMAP_MIN_QUARTERS = 1;
export const ROADMAP_MAX_QUARTERS = 12;
export const ROADMAP_DEFAULT_LOOKAHEAD_QUARTERS = 4;

/**
 * Canonical quarter identifier: `YYYY-Qn` where n ∈ {1, 2, 3, 4}. Enforced
 * everywhere via `QUARTER_ID_REGEXP` so backend, frontend, and Prisma
 * migrations all speak the same string.
 */
export const QUARTER_ID_REGEXP: RegExp = /^\d{4}-Q[1-4]$/;

/**
 * Roadmap Epic lifecycle statuses (PRD FR-21). `CANCELED` is included so
 * closed-out work does not silently disappear from the grid — the UI dims
 * canceled epics instead of hiding them.
 */
export const EPIC_STATUSES = ['PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELED'] as const;

export type EpicStatus = (typeof EPIC_STATUSES)[number];

/**
 * Bundled snapshot for consumers that want the whole config in one import.
 * Frozen to make accidental mutation a type error.
 */
export const RoadmapConfig = Object.freeze({
  fiscalYearOffsets: FISCAL_YEAR_OFFSETS_MONTHS,
  fiscalYearOffsetDefault: FISCAL_YEAR_OFFSET_DEFAULT,
  minQuarters: ROADMAP_MIN_QUARTERS,
  maxQuarters: ROADMAP_MAX_QUARTERS,
  defaultLookaheadQuarters: ROADMAP_DEFAULT_LOOKAHEAD_QUARTERS,
  quarterIdRegExpSource: QUARTER_ID_REGEXP.source,
  epicStatuses: EPIC_STATUSES,
});

/**
 * Type guard used by exception filters, tests, and the Prisma seeder.
 */
export function isQuarterId(value: unknown): value is string {
  return typeof value === 'string' && QUARTER_ID_REGEXP.test(value);
}

/**
 * Type guard for Epic status (paired with `isSprintState` in
 * `sprint-policy.ts` — same shape, same rationale).
 */
export function isEpicStatus(value: unknown): value is EpicStatus {
  return typeof value === 'string' && (EPIC_STATUSES as readonly string[]).includes(value);
}
