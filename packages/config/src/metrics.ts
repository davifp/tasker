/**
 * Metric definitions and refresh cadence shared by the backend metrics module
 * (`MetricsService`, `MetricsRefreshProcessor`) and the frontend dashboard
 * (`MetricDefinitionPopover`, `DashboardShell`). The strings and constants
 * here are the single source of truth per PRD FR-28: the definition displayed
 * next to the number MUST match the definition the calculator uses.
 */

/**
 * Locked, user-facing definitions surfaced in the dashboard next to each
 * number. Copy changes require a documented workspace-level migration so
 * historical comparisons remain meaningful.
 */
export const METRIC_DEFINITIONS = Object.freeze({
  leadTime:
    'Lead time = task creation → Done. Measured in business hours in the workspace timezone.',
  cycleTime:
    'Cycle time = first transition into In Progress → Done. Measured in business hours in the workspace timezone.',
});

export type MetricKey = keyof typeof METRIC_DEFINITIONS;

/**
 * Default cadence for the repeatable BullMQ job that refreshes the two
 * materialized views. Every 15 minutes on the wall clock keeps the "as of"
 * timestamp fresh without stampeding a large workspace on every task update.
 */
export const METRICS_REFRESH_CRON_DEFAULT = '*/15 * * * *';

/**
 * Per-workspace SETNX mutex TTL (seconds) guarding matview refresh. Longer
 * than the P99 refresh duration observed in load tests so a crashed worker
 * cannot leave a stale lock forever, short enough that on-demand refreshes
 * queued back-to-back do not stack.
 */
export const METRICS_REFRESH_LOCK_TTL_SEC_DEFAULT = 900;

/**
 * Redis debounce window (seconds) for `TaskStatusChangedListener` so a burst
 * of status transitions collapses into one workspace-scoped refresh instead
 * of N.
 */
export const METRICS_REFRESH_DEBOUNCE_SEC_DEFAULT = 15;

/**
 * Selectable windows offered on the dashboard for cycle/lead time. Default
 * matches PRD FR-27 ("default: last quarter"). Values are relative to the
 * request time; the API turns them into absolute date ranges.
 */
export const METRICS_WINDOW_PRESETS = [
  'last_week',
  'last_month',
  'last_quarter',
  'last_year',
] as const;

export type MetricsWindowPreset = (typeof METRICS_WINDOW_PRESETS)[number];

export const METRICS_DEFAULT_WINDOW: MetricsWindowPreset = 'last_quarter';

/**
 * Workspace-timezone business-hours envelope used by the cycle/lead time
 * calculator. Constants live in shared config so the client-side popover can
 * show the same window ("9:00–18:00, Mon–Fri") the server measures against.
 * `workDays` follows JS `getUTCDay()`: 0 = Sunday, 1 = Monday … 6 = Saturday.
 */
export const BUSINESS_HOURS = Object.freeze({
  startHour: 9,
  endHour: 18,
  workDays: Object.freeze([1, 2, 3, 4, 5]) as readonly number[],
});

/**
 * Bundled snapshot for API responses that carry the metric-definition
 * envelope inline (dashboard endpoints). Freezing makes accidental mutation
 * on the client a type error.
 */
export const MetricsConfig = Object.freeze({
  definitions: METRIC_DEFINITIONS,
  refreshCronDefault: METRICS_REFRESH_CRON_DEFAULT,
  refreshLockTtlSecDefault: METRICS_REFRESH_LOCK_TTL_SEC_DEFAULT,
  refreshDebounceSecDefault: METRICS_REFRESH_DEBOUNCE_SEC_DEFAULT,
  windowPresets: METRICS_WINDOW_PRESETS,
  defaultWindow: METRICS_DEFAULT_WINDOW,
  businessHours: BUSINESS_HOURS,
});
