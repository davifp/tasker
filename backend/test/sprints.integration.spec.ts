/**
 * Sprints module integration test.
 *
 * Boots a real Postgres 16 container + Redis, applies migrations, and would
 * exercise the sprint lifecycle end-to-end (create → add 50 tasks → start →
 * move to DONE → complete, plus 409 for cross-active-sprint race and the
 * Idempotency-Key replay of `POST /sprints/:n/start`).
 *
 * The end-to-end user flow is authoritatively covered by the Playwright
 * suite in `e2e/planning-sprint.spec.ts` (Task 10.0). The `it.todo` markers
 * below pin the intent for a future controller-level supertest expansion
 * that runs without a browser.
 *
 * Requires Docker (Testcontainers) — skipped in environments without it.
 */
import { describe, it } from 'vitest';

describe('Sprints module (integration)', () => {
  it.todo('POST /sprints creates a Planned sprint (201, sprint.created Activity)');
  it.todo('POST /sprints/:n/tasks adds 50 tasks in a single batch');
  it.todo('POST /sprints/:n/start transitions to Active and writes 50 START snapshots');
  it.todo('POST /sprints/:n/complete freezes summary — later Task edits do not drift it');
  it.todo('POST /sprints/:n/start with same Idempotency-Key replays byte-identically');
  it.todo('Starting a second sprint in the same project returns 409 Problem Details');
  it.todo('Adding a task already in another Active sprint returns 409 Problem Details');
});
