/**
 * Metrics + dashboard integration test skeleton.
 *
 * Testcontainers-backed Postgres 16 + Redis 7 would apply matviews, seed 500
 * tasks and a closed sprint, run `metrics.refresh`, and assert:
 *   - concurrent refresh succeeds (proves the unique matview indexes);
 *   - `asOf` advances after a successful refresh, stays flat after a failed one;
 *   - dashboard-endpoint P95 latency below the 300 ms SLO with the seed;
 *   - two workspaces racing the refresh serialise per matview (mutex), not global.
 *
 * The full user flow lands in `e2e/planning-dashboard.spec.ts` (Task 10.0).
 */
import { describe, it } from 'vitest';

describe('Metrics + dashboard (integration)', () => {
  it.todo('metrics.refresh REFRESH CONCURRENTLY succeeds on both matviews');
  it.todo('asOf advances after a successful global refresh');
  it.todo('asOf stays flat when the refresh fails; MetricJobLog gets a FAILED row');
  it.todo('GET /dashboard/cycle-lead-time P95 < 300ms with 500-task seed');
  it.todo('two racing workspace refreshes serialise per matview (Redis SETNX mutex)');
  it.todo('cold-cache workspace returns { data: [], asOf: null }');
});
