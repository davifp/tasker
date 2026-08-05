import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Counter, Histogram } from 'prom-client';
import type { ActivityBusEvent } from '../common/activity/activity.bus';
import { MetricsRegistryService } from './metrics-registry.service';

const REFRESH_MS_BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000];
const READ_MS_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500];
const BATCH_SIZE_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500];

// Planning-surface metrics — sprint transitions, epic writes, matview refresh
// timings, dashboard read latency, backlog batch sizes. All metrics live on
// the shared registry; the controller renders them via `Registry.metrics()`.
@Injectable()
export class PlanningMetricsCollector {
  private readonly sprintTransitions: Counter<'from' | 'to'>;
  private readonly sprintSnapshotRows: Counter<'phase'>;
  private readonly epicWrites: Counter<'action'>;
  private readonly metricsRefreshMs: Histogram<'matview'>;
  private readonly metricsRefreshFailed: Counter<'matview' | 'reason'>;
  private readonly dashboardReadMs: Histogram<'endpoint'>;
  private readonly backlogMoveBatchSize: Histogram<never>;

  constructor(registry: MetricsRegistryService) {
    this.sprintTransitions = registry.counter({
      name: 'tasker_sprint_transition_total',
      help: 'Sprint state transitions.',
      labelNames: ['from', 'to'] as const,
    });
    this.sprintSnapshotRows = registry.counter({
      name: 'tasker_sprint_snapshot_rows_total',
      help: 'Snapshot rows written per phase.',
      labelNames: ['phase'] as const,
    });
    this.epicWrites = registry.counter({
      name: 'tasker_epic_write_total',
      help: 'Epic write mutations.',
      labelNames: ['action'] as const,
    });
    this.metricsRefreshMs = registry.histogram({
      name: 'tasker_metrics_refresh_ms',
      help: 'Matview refresh duration in ms.',
      labelNames: ['matview'] as const,
      buckets: REFRESH_MS_BUCKETS,
    });
    this.metricsRefreshFailed = registry.counter({
      name: 'tasker_metrics_refresh_failed_total',
      help: 'Matview refresh failures.',
      labelNames: ['matview', 'reason'] as const,
    });
    this.dashboardReadMs = registry.histogram({
      name: 'tasker_dashboard_read_ms',
      help: 'Dashboard endpoint latency in ms.',
      labelNames: ['endpoint'] as const,
      buckets: READ_MS_BUCKETS,
    });
    this.backlogMoveBatchSize = registry.histogram({
      name: 'tasker_backlog_move_batch_size',
      help: 'Number of tasks per planner mutation.',
      buckets: BATCH_SIZE_BUCKETS,
    });
  }

  incrementSprintTransition(from: string, to: string): void {
    this.sprintTransitions.inc({ from, to });
  }

  incrementSprintSnapshotRows(phase: 'START' | 'COMPLETE', rows: number): void {
    this.sprintSnapshotRows.inc({ phase }, rows);
  }

  incrementEpicWrite(action: 'created' | 'updated' | 'deleted'): void {
    this.epicWrites.inc({ action });
  }

  observeMetricsRefreshMs(matview: string, ms: number): void {
    this.metricsRefreshMs.observe({ matview }, ms);
  }

  incrementMetricsRefreshFailed(matview: string, reason: string): void {
    this.metricsRefreshFailed.inc({ matview, reason });
  }

  observeDashboardReadMs(endpoint: string, ms: number): void {
    this.dashboardReadMs.observe({ endpoint }, ms);
  }

  observeBacklogMoveBatchSize(size: number): void {
    this.backlogMoveBatchSize.observe(size);
  }

  @OnEvent('activity.sprint.started')
  onSprintStarted(_event: ActivityBusEvent): void {
    this.incrementSprintTransition('PLANNED', 'ACTIVE');
  }

  @OnEvent('activity.sprint.completed')
  onSprintCompleted(_event: ActivityBusEvent): void {
    this.incrementSprintTransition('ACTIVE', 'COMPLETED');
  }

  @OnEvent('activity.epic.created')
  onEpicCreated(): void {
    this.incrementEpicWrite('created');
  }

  @OnEvent('activity.epic.updated')
  onEpicUpdated(): void {
    this.incrementEpicWrite('updated');
  }

  @OnEvent('activity.epic.deleted')
  onEpicDeleted(): void {
    this.incrementEpicWrite('deleted');
  }
}
