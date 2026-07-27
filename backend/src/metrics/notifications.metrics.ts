import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationsMetricsCollector {
  // channel|eventType|result -> count
  private readonly deliveredTotal = new Map<string, number>();
  // reason -> count (only 'gone' at the moment; kept as a label so a future
  // classifier can add 'dormant' without breaking the graph).
  private readonly pushCleanedTotal = new Map<string, number>();

  incrementDelivered(
    channel: 'IN_APP' | 'EMAIL' | 'PUSH',
    eventType: string,
    result: 'success' | 'failure' | 'skipped',
  ): void {
    const key = `${channel}|${eventType}|${result}`;
    this.deliveredTotal.set(key, (this.deliveredTotal.get(key) ?? 0) + 1);
  }

  incrementPushCleaned(reason: 'gone' | 'dormant'): void {
    this.pushCleanedTotal.set(reason, (this.pushCleanedTotal.get(reason) ?? 0) + 1);
  }

  render(): string {
    const lines: string[] = [];

    lines.push('# HELP tasker_notification_delivered_total Notifications delivered by channel.');
    lines.push('# TYPE tasker_notification_delivered_total counter');
    for (const [key, value] of this.deliveredTotal) {
      const [channel, eventType, result] = key.split('|');
      lines.push(
        `tasker_notification_delivered_total{channel="${channel}",event_type="${eventType}",result="${result}"} ${value}`,
      );
    }

    lines.push('# HELP tasker_push_subscriptions_cleaned_total Push subscription rows reaped.');
    lines.push('# TYPE tasker_push_subscriptions_cleaned_total counter');
    for (const [reason, value] of this.pushCleanedTotal) {
      lines.push(`tasker_push_subscriptions_cleaned_total{reason="${reason}"} ${value}`);
    }

    return lines.join('\n') + '\n';
  }

  snapshot() {
    return {
      deliveredTotal: Object.fromEntries(this.deliveredTotal),
      pushCleanedTotal: Object.fromEntries(this.pushCleanedTotal),
    };
  }
}
