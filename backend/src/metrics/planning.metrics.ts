import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ActivityBusEvent } from '../common/activity/activity.bus';

/**
 * Lightweight in-memory metrics collector for the planning surface.
 * Mirrors the pattern used by `ActivityInterceptor.getCounters()` — a
 * follow-up will front this with `prom-client` and expose it under
 * `/metrics`, but the counter shape is already correct so the exporter
 * change stays purely additive.
 *
 * Metric names match the techspec § Monitoring:
 *   - tasker_sprint_transition_total{from,to}
 *   - tasker_sprint_snapshot_rows_total{phase}
 *   - tasker_epic_write_total{action}
 *   - tasker_metrics_refresh_ms{matview}            (histogram; last N samples kept)
 *   - tasker_metrics_refresh_failed_total{matview,reason}
 *   - tasker_dashboard_read_ms{endpoint}            (histogram; last N samples kept)
 *   - tasker_backlog_move_batch_size                 (histogram; last N samples kept)
 */

const HISTOGRAM_MAX_SAMPLES = 500;

interface Histogram {
  samples: number[];
  observe(value: number): void;
}

function makeHistogram(): Histogram {
  const samples: number[] = [];
  return {
    samples,
    observe(value: number) {
      samples.push(value);
      if (samples.length > HISTOGRAM_MAX_SAMPLES) samples.shift();
    },
  };
}

@Injectable()
export class PlanningMetricsCollector {
  private readonly logger = new Logger(PlanningMetricsCollector.name);

  private readonly sprintTransitions = new Map<string, number>();
  private readonly sprintSnapshotRows = new Map<string, number>();
  private readonly epicWrites = new Map<string, number>();
  private readonly metricsRefreshMs = new Map<string, Histogram>();
  private readonly metricsRefreshFailed = new Map<string, number>();
  private readonly dashboardReadMs = new Map<string, Histogram>();
  private readonly backlogMoveBatchSize = makeHistogram();

  incrementSprintTransition(from: string, to: string): void {
    const key = `${from}->${to}`;
    this.sprintTransitions.set(key, (this.sprintTransitions.get(key) ?? 0) + 1);
  }

  incrementSprintSnapshotRows(phase: 'START' | 'COMPLETE', rows: number): void {
    this.sprintSnapshotRows.set(phase, (this.sprintSnapshotRows.get(phase) ?? 0) + rows);
  }

  incrementEpicWrite(action: 'created' | 'updated' | 'deleted'): void {
    this.epicWrites.set(action, (this.epicWrites.get(action) ?? 0) + 1);
  }

  observeMetricsRefreshMs(matview: string, ms: number): void {
    const h = this.metricsRefreshMs.get(matview) ?? makeHistogram();
    h.observe(ms);
    this.metricsRefreshMs.set(matview, h);
  }

  incrementMetricsRefreshFailed(matview: string, reason: string): void {
    const key = `${matview}|${reason}`;
    this.metricsRefreshFailed.set(key, (this.metricsRefreshFailed.get(key) ?? 0) + 1);
  }

  observeDashboardReadMs(endpoint: string, ms: number): void {
    const h = this.dashboardReadMs.get(endpoint) ?? makeHistogram();
    h.observe(ms);
    this.dashboardReadMs.set(endpoint, h);
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

  /**
   * Renders the collector state in the Prometheus text-based format so an
   * exporter (either a raw `/metrics` route or `prom-client` in the
   * follow-up) can emit it directly.
   */
  render(): string {
    const lines: string[] = [];
    lines.push('# HELP tasker_sprint_transition_total Sprint state transitions.');
    lines.push('# TYPE tasker_sprint_transition_total counter');
    for (const [key, value] of this.sprintTransitions) {
      const [from, to] = key.split('->');
      lines.push(`tasker_sprint_transition_total{from="${from}",to="${to}"} ${value}`);
    }

    lines.push('# HELP tasker_sprint_snapshot_rows_total Snapshot rows written per phase.');
    lines.push('# TYPE tasker_sprint_snapshot_rows_total counter');
    for (const [phase, value] of this.sprintSnapshotRows) {
      lines.push(`tasker_sprint_snapshot_rows_total{phase="${phase}"} ${value}`);
    }

    lines.push('# HELP tasker_epic_write_total Epic write mutations.');
    lines.push('# TYPE tasker_epic_write_total counter');
    for (const [action, value] of this.epicWrites) {
      lines.push(`tasker_epic_write_total{action="${action}"} ${value}`);
    }

    lines.push('# HELP tasker_metrics_refresh_failed_total Matview refresh failures.');
    lines.push('# TYPE tasker_metrics_refresh_failed_total counter');
    for (const [key, value] of this.metricsRefreshFailed) {
      const [matview, reason] = key.split('|');
      lines.push(
        `tasker_metrics_refresh_failed_total{matview="${matview}",reason="${reason}"} ${value}`,
      );
    }

    lines.push('# HELP tasker_metrics_refresh_ms Matview refresh duration in ms.');
    lines.push('# TYPE tasker_metrics_refresh_ms summary');
    for (const [matview, hist] of this.metricsRefreshMs) {
      lines.push(...summaryLines('tasker_metrics_refresh_ms', { matview }, hist.samples));
    }

    lines.push('# HELP tasker_dashboard_read_ms Dashboard endpoint latency in ms.');
    lines.push('# TYPE tasker_dashboard_read_ms summary');
    for (const [endpoint, hist] of this.dashboardReadMs) {
      lines.push(...summaryLines('tasker_dashboard_read_ms', { endpoint }, hist.samples));
    }

    lines.push('# HELP tasker_backlog_move_batch_size Number of tasks per planner mutation.');
    lines.push('# TYPE tasker_backlog_move_batch_size summary');
    lines.push(
      ...summaryLines('tasker_backlog_move_batch_size', {}, this.backlogMoveBatchSize.samples),
    );

    return lines.join('\n') + '\n';
  }

  /** Returns a defensive snapshot for tests. */
  snapshot() {
    return {
      sprintTransitions: Object.fromEntries(this.sprintTransitions),
      sprintSnapshotRows: Object.fromEntries(this.sprintSnapshotRows),
      epicWrites: Object.fromEntries(this.epicWrites),
      metricsRefreshFailed: Object.fromEntries(this.metricsRefreshFailed),
      backlogMoveBatchSize: [...this.backlogMoveBatchSize.samples],
    };
  }
}

function summaryLines(name: string, labels: Record<string, string>, samples: number[]): string[] {
  if (samples.length === 0) return [];
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  const prefix = labelStr ? `${labelStr},` : '';
  const sum = sorted.reduce((a, b) => a + b, 0);
  return [
    `${name}{${prefix}quantile="0.5"} ${p(0.5)}`,
    `${name}{${prefix}quantile="0.9"} ${p(0.9)}`,
    `${name}{${prefix}quantile="0.95"} ${p(0.95)}`,
    `${name}_sum{${labelStr}} ${sum}`,
    `${name}_count{${labelStr}} ${sorted.length}`,
  ];
}
