import { Injectable } from '@nestjs/common';
import type { Counter } from 'prom-client';
import { MetricsRegistryService } from '../../metrics/metrics-registry.service';

// Public-API rate-limit metrics. Consumed by the Grafana panel from Task 9.0.
@Injectable()
export class RateLimitMetricsCollector {
  private readonly requestsTotal: Counter<'key_prefix' | 'status'>;
  private readonly rateLimitHitsTotal: Counter<'key_prefix'>;

  constructor(registry: MetricsRegistryService) {
    this.requestsTotal = registry.counter({
      name: 'platform_api_requests_total',
      help: 'Public-API requests by key prefix and status.',
      labelNames: ['key_prefix', 'status'] as const,
    });
    this.rateLimitHitsTotal = registry.counter({
      name: 'platform_api_ratelimit_hits_total',
      help: 'Public-API 429 responses by key prefix.',
      labelNames: ['key_prefix'] as const,
    });
  }

  incrementRequest(keyPrefix: string, status: number): void {
    this.requestsTotal.inc({ key_prefix: keyPrefix, status: String(status) });
  }

  incrementRateLimitHit(keyPrefix: string): void {
    this.rateLimitHitsTotal.inc({ key_prefix: keyPrefix });
  }
}
