/**
 * Epics + Roadmap integration test skeleton.
 *
 * Testcontainers-backed Postgres exercises full CRUD, cross-workspace
 * isolation for reads and writes, task link/unlink round trip preserving
 * `Task.epicId` semantics, and roadmap-query results for a multi-quarter
 * window with mixed statuses.
 *
 * The Playwright suite in `e2e/planning-roadmap.spec.ts` (Task 10.0) covers
 * the full user flow (drag epic between quarters, resize span, link task).
 * These `it.todo` markers pin intent for a future supertest expansion that
 * runs without a browser.
 */
import { describe, it } from 'vitest';

describe('Epics + Roadmap (integration)', () => {
  it.todo('POST /projects/:slug/epics creates an epic in the caller workspace');
  it.todo('PATCH /epics/:id reposition — one epic.updated Activity emitted');
  it.todo('DELETE /epics/:id soft-deletes; linked tasks keep Task.epicId');
  it.todo('POST /epics/:id/tasks/:taskId links; DELETE unlinks — round trip');
  it.todo('GET /roadmap ?fromQuarter&toQuarter returns only epics overlapping the window');
  it.todo('Cross-workspace: a member of W1 cannot GET /roadmap for W2');
});
