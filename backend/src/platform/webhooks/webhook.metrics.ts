import { Injectable } from '@nestjs/common';

// Histogram buckets in seconds — mirror the ones used by rate-limit metrics
// so operators can scan them at a glance.
const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type Outcome = 'success' | 'retry' | 'dlq';

interface HistogramState {
  buckets: number[]; // parallel to LATENCY_BUCKETS + 1 (last is +Inf)
  sum: number;
  count: number;
}

@Injectable()
export class WebhookMetricsCollector {
  private readonly deliveryTotal = new Map<Outcome, number>();
  private readonly latency = new Map<Outcome, HistogramState>();

  incrementDelivery(outcome: Outcome): void {
    this.deliveryTotal.set(outcome, (this.deliveryTotal.get(outcome) ?? 0) + 1);
  }

  observeLatency(outcome: Outcome, seconds: number): void {
    let hist = this.latency.get(outcome);
    if (!hist) {
      hist = {
        buckets: new Array<number>(LATENCY_BUCKETS.length + 1).fill(0),
        sum: 0,
        count: 0,
      };
      this.latency.set(outcome, hist);
    }
    hist.sum += seconds;
    hist.count += 1;
    let placed = false;
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      const bucket = LATENCY_BUCKETS[i]!;
      if (seconds <= bucket) {
        hist.buckets[i] = (hist.buckets[i] ?? 0) + 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const last = LATENCY_BUCKETS.length;
      hist.buckets[last] = (hist.buckets[last] ?? 0) + 1;
    }
  }

  render(): string {
    const lines: string[] = [];

    lines.push('# HELP platform_webhook_delivery_total Webhook deliveries by outcome.');
    lines.push('# TYPE platform_webhook_delivery_total counter');
    for (const [outcome, value] of this.deliveryTotal) {
      lines.push(`platform_webhook_delivery_total{outcome="${outcome}"} ${value}`);
    }

    lines.push('# HELP platform_webhook_delivery_latency_seconds Delivery attempt latency.');
    lines.push('# TYPE platform_webhook_delivery_latency_seconds histogram');
    for (const [outcome, hist] of this.latency) {
      let cumulative = 0;
      for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
        cumulative += hist.buckets[i] ?? 0;
        lines.push(
          `platform_webhook_delivery_latency_seconds_bucket{outcome="${outcome}",le="${LATENCY_BUCKETS[i]}"} ${cumulative}`,
        );
      }
      cumulative += hist.buckets[LATENCY_BUCKETS.length] ?? 0;
      lines.push(
        `platform_webhook_delivery_latency_seconds_bucket{outcome="${outcome}",le="+Inf"} ${cumulative}`,
      );
      lines.push(`platform_webhook_delivery_latency_seconds_sum{outcome="${outcome}"} ${hist.sum}`);
      lines.push(
        `platform_webhook_delivery_latency_seconds_count{outcome="${outcome}"} ${hist.count}`,
      );
    }

    return lines.join('\n') + '\n';
  }

  snapshot() {
    return {
      deliveryTotal: Object.fromEntries(this.deliveryTotal),
      latency: Object.fromEntries(this.latency),
    };
  }
}
