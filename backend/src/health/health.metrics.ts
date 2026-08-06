import { Injectable } from '@nestjs/common';
import type { Gauge } from 'prom-client';
import { MetricsRegistryService } from '../metrics/metrics-registry.service';

/**
 * Prometheus gauges emitted by the deep readiness probe. `HealthController`
 * calls `record()` after each `/readiness` invocation so alerts can trigger on
 * the aggregate signal or on a specific dependency.
 *
 * The gauges are readiness-only: they reflect the last time a probe caller
 * (nginx, K8s, curl) hit the endpoint. That means the alerting cadence is
 * bounded by the probe interval, which is exactly the semantic we want for a
 * readiness alert.
 */
@Injectable()
export class HealthMetrics {
  private readonly readinessOk: Gauge<never>;
  private readonly readinessDepOk: Gauge<'dep'>;

  constructor(private readonly registry: MetricsRegistryService) {
    this.readinessOk = registry.gauge({
      name: 'tasker_readiness_ok',
      help: 'Last readiness result — 1 when all critical dependencies passed, 0 otherwise.',
    });
    this.readinessDepOk = registry.gauge({
      name: 'tasker_readiness_dep_ok',
      help: 'Per-dependency readiness result — 1 when the dependency reported up on the last probe.',
      labelNames: ['dep'] as const,
    });
  }

  record(deps: Record<string, boolean>): void {
    for (const [dep, ok] of Object.entries(deps)) {
      this.readinessDepOk.set({ dep }, ok ? 1 : 0);
    }
    const allOk = Object.values(deps).every((v) => v);
    this.readinessOk.set(allOk ? 1 : 0);
  }
}
