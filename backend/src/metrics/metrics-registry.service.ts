import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
  Summary,
  type CounterConfiguration,
  type GaugeConfiguration,
  type HistogramConfiguration,
  type SummaryConfiguration,
} from 'prom-client';
import type { Env } from '@tasker/config';

// Shared prom-client registry. Every collector registers its metrics here so
// `MetricsController` can serve a single `/metrics` text-exposition dump.
// The service also exposes `build_info` seeded with the release id / node
// version so operators can join scrape results to the deployed build.
@Injectable()
export class MetricsRegistryService implements OnModuleInit {
  readonly registry = new Registry();
  private buildInfo?: Gauge<string>;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    // Node.js process metrics (event-loop lag, GC pauses, resident set size).
    collectDefaultMetrics({ register: this.registry, prefix: 'tasker_' });

    this.buildInfo = this.gauge({
      name: 'tasker_build_info',
      help: 'Static build identifier for the running process (labels only).',
      labelNames: ['release', 'service', 'node_version'] as const,
    });
    this.buildInfo.set(
      {
        release: this.config.get('RELEASE_ID') || 'dev',
        service: process.env['OTEL_SERVICE_NAME'] ?? 'tasker-api',
        node_version: process.version,
      },
      1,
    );
  }

  counter<L extends string>(cfg: CounterConfiguration<L>): Counter<L> {
    return new Counter({ ...cfg, registers: [this.registry] });
  }

  gauge<L extends string>(cfg: GaugeConfiguration<L>): Gauge<L> {
    return new Gauge({ ...cfg, registers: [this.registry] });
  }

  histogram<L extends string>(cfg: HistogramConfiguration<L>): Histogram<L> {
    return new Histogram({ ...cfg, registers: [this.registry] });
  }

  summary<L extends string>(cfg: SummaryConfiguration<L>): Summary<L> {
    return new Summary({ ...cfg, registers: [this.registry] });
  }

  /** Prometheus text exposition format 0.0.4. Async because default-metrics collect asynchronously. */
  render(): Promise<string> {
    return this.registry.metrics();
  }

  /** Test helper — resets every metric to zero (default metrics excluded). */
  resetAll(): void {
    this.registry.resetMetrics();
  }
}
