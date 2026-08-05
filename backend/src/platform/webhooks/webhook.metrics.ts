import { Injectable } from '@nestjs/common';
import type { Counter, Histogram } from 'prom-client';
import { MetricsRegistryService } from '../../metrics/metrics-registry.service';

const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type Outcome = 'success' | 'retry' | 'dlq';

@Injectable()
export class WebhookMetricsCollector {
  private readonly deliveryTotal: Counter<'outcome'>;
  private readonly latency: Histogram<'outcome'>;

  constructor(registry: MetricsRegistryService) {
    this.deliveryTotal = registry.counter({
      name: 'platform_webhook_delivery_total',
      help: 'Webhook deliveries by outcome.',
      labelNames: ['outcome'] as const,
    });
    this.latency = registry.histogram({
      name: 'platform_webhook_delivery_latency_seconds',
      help: 'Delivery attempt latency.',
      labelNames: ['outcome'] as const,
      buckets: LATENCY_BUCKETS,
    });
  }

  incrementDelivery(outcome: Outcome): void {
    this.deliveryTotal.inc({ outcome });
  }

  observeLatency(outcome: Outcome, seconds: number): void {
    this.latency.observe({ outcome }, seconds);
  }
}
