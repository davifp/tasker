import { describe, it, expect, beforeEach } from 'vitest';
import { PlanningMetricsCollector } from './planning.metrics';

describe('PlanningMetricsCollector', () => {
  let metrics: PlanningMetricsCollector;

  beforeEach(() => {
    metrics = new PlanningMetricsCollector();
  });

  it('increments sprint transition counters', () => {
    metrics.incrementSprintTransition('PLANNED', 'ACTIVE');
    metrics.incrementSprintTransition('PLANNED', 'ACTIVE');
    metrics.incrementSprintTransition('ACTIVE', 'COMPLETED');
    const snap = metrics.snapshot();
    expect(snap.sprintTransitions['PLANNED->ACTIVE']).toBe(2);
    expect(snap.sprintTransitions['ACTIVE->COMPLETED']).toBe(1);
  });

  it('accumulates snapshot rows per phase', () => {
    metrics.incrementSprintSnapshotRows('START', 5);
    metrics.incrementSprintSnapshotRows('START', 3);
    expect(metrics.snapshot().sprintSnapshotRows.START).toBe(8);
  });

  it('renders Prometheus text format with the emitted metrics', () => {
    metrics.incrementSprintTransition('PLANNED', 'ACTIVE');
    metrics.incrementEpicWrite('created');
    metrics.observeBacklogMoveBatchSize(10);
    metrics.observeMetricsRefreshMs('mv_sprint_daily_burndown', 320);
    metrics.incrementMetricsRefreshFailed('mv_sprint_daily_burndown', 'lock_timeout');

    const text = metrics.render();
    expect(text).toContain('tasker_sprint_transition_total{from="PLANNED",to="ACTIVE"} 1');
    expect(text).toContain('tasker_epic_write_total{action="created"} 1');
    expect(text).toContain('tasker_metrics_refresh_ms{matview="mv_sprint_daily_burndown"');
    expect(text).toContain(
      'tasker_metrics_refresh_failed_total{matview="mv_sprint_daily_burndown",reason="lock_timeout"} 1',
    );
    expect(text).toContain('tasker_backlog_move_batch_size');
  });
});
