/**
 * Sprint lifecycle policy shared by the backend `sprints` module and the
 * frontend planner. Constants here are the source of truth for boundaries
 * every controller, service, and form must enforce.
 */

/**
 * Ordered lifecycle states (PRD FR-1..FR-6). Order matters: a state can only
 * transition forward in the array, never backward.
 */
export const SPRINT_STATES = ['PLANNED', 'ACTIVE', 'COMPLETED'] as const;

export type SprintState = (typeof SPRINT_STATES)[number];

/**
 * PRD FR-2: at most one Active sprint per project. Enforced at three layers:
 * partial unique index in Postgres, application check in
 * `SprintPlannerService.addTasks`, and this shared constant so error
 * messages and UI copy stay consistent.
 */
export const SPRINT_MAX_ACTIVE_PER_PROJECT = 1;

/**
 * Sprint length guardrails (days, inclusive). The lower bound rules out
 * degenerate 0-day sprints; the upper bound rules out year-long "quarters
 * masquerading as sprints" and matches the default in
 * `SPRINT_MAX_DAYS` env override (see techspec.md → Technical dependencies).
 */
export const SPRINT_MIN_DAYS = 1;
export const SPRINT_MAX_DAYS_DEFAULT = 31;

/**
 * Snapshot phases written to `SprintTaskSnapshot` (PRD FR-9, FR-10). Kept
 * here as an `as const` array so validators, Prisma enum values, and UI
 * badges cannot drift.
 */
export const SPRINT_SNAPSHOT_PHASES = ['START', 'COMPLETE'] as const;

export type SprintSnapshotPhase = (typeof SPRINT_SNAPSHOT_PHASES)[number];

/**
 * Bundled snapshot exposed to any consumer that wants the whole policy in one
 * import (form defaults, storybook fixtures, docs pages). Frozen to make
 * accidental mutation a type error.
 */
export const SprintPolicy = Object.freeze({
  states: SPRINT_STATES,
  maxActivePerProject: SPRINT_MAX_ACTIVE_PER_PROJECT,
  minDays: SPRINT_MIN_DAYS,
  maxDaysDefault: SPRINT_MAX_DAYS_DEFAULT,
  snapshotPhases: SPRINT_SNAPSHOT_PHASES,
});

/**
 * Type guard consumed by exception filters and API tests. Kept out of the
 * Zod layer so it can be reused where a Zod parser would be overkill.
 */
export function isSprintState(value: unknown): value is SprintState {
  return typeof value === 'string' && (SPRINT_STATES as readonly string[]).includes(value);
}
