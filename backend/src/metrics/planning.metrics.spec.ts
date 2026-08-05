import { describe, it, expect, beforeEach } from 'vitest';
import { PlanningMetricsCollector } from './planning.metrics';
import { createTestMetricsRegistry } from './metrics-registry.test-helpers';
import type { MetricsRegistryService } from './metrics-registry.service';

describe('PlanningMetricsCollector', () => {
  let registry: MetricsRegistryService;
  let metrics: PlanningMetricsCollector;

  beforeEach(() => {
    registry = createTestMetricsRegistry();
    metrics = new PlanningMetricsCollector(registry);
  });

  it('increments sprint transition counters keyed by from/to labels', async () => {
    metrics.incrementSprintTransition('PLANNED', 'ACTIVE');
    metrics.incrementSprintTransition('PLANNED', 'ACTIVE');
    metrics.incrementSprintTransition('ACTIVE', 'COMPLETED');
    const text = await registry.render();
    expect(text).toContain('tasker_sprint_transition_total{from="PLANNED",to="ACTIVE"} 2');
    expect(text).toContain('tasker_sprint_transition_total{from="ACTIVE",to="COMPLETED"} 1');
  });

  it('accumulates snapshot rows per phase', async () => {
    metrics.incrementSprintSnapshotRows('START', 5);
    metrics.incrementSprintSnapshotRows('START', 3);
    expect(await registry.render()).toContain('tasker_sprint_snapshot_rows_total{phase="START"} 8');
  });

  it('renders every registered family with the emitted metrics', async () => {
    metrics.incrementSprintTransition('PLANNED', 'ACTIVE');
    metrics.incrementEpicWrite('created');
    metrics.observeBacklogMoveBatchSize(10);
    metrics.observeMetricsRefreshMs('mv_sprint_daily_burndown', 320);
    metrics.incrementMetricsRefreshFailed('mv_sprint_daily_burndown', 'lock_timeout');

    const text = await registry.render();
    expect(text).toContain('tasker_sprint_transition_total{from="PLANNED",to="ACTIVE"} 1');
    expect(text).toContain('tasker_epic_write_total{action="created"} 1');
    expect(text).toContain('tasker_metrics_refresh_ms_bucket{');
    expect(text).toContain('matview="mv_sprint_daily_burndown"');
    expect(text).toContain(
      'tasker_metrics_refresh_failed_total{matview="mv_sprint_daily_burndown",reason="lock_timeout"} 1',
    );
    expect(text).toContain('tasker_backlog_move_batch_size_bucket');
  });
});
