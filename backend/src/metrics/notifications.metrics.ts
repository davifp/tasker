import { Injectable } from '@nestjs/common';
import type { Counter } from 'prom-client';
import { MetricsRegistryService } from './metrics-registry.service';

@Injectable()
export class NotificationsMetricsCollector {
  private readonly deliveredTotal: Counter<'channel' | 'event_type' | 'result'>;
  private readonly pushCleanedTotal: Counter<'reason'>;

  constructor(registry: MetricsRegistryService) {
    this.deliveredTotal = registry.counter({
      name: 'tasker_notification_delivered_total',
      help: 'Notifications delivered by channel.',
      labelNames: ['channel', 'event_type', 'result'] as const,
    });
    this.pushCleanedTotal = registry.counter({
      name: 'tasker_push_subscriptions_cleaned_total',
      help: 'Push subscription rows reaped.',
      labelNames: ['reason'] as const,
    });
  }

  incrementDelivered(
    channel: 'IN_APP' | 'EMAIL' | 'PUSH',
    eventType: string,
    result: 'success' | 'failure' | 'skipped',
  ): void {
    this.deliveredTotal.inc({ channel, event_type: eventType, result });
  }

  incrementPushCleaned(reason: 'gone' | 'dormant'): void {
    this.pushCleanedTotal.inc({ reason });
  }
}
