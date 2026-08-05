import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationsMetricsCollector } from './notifications.metrics';
import { createTestMetricsRegistry } from './metrics-registry.test-helpers';
import type { MetricsRegistryService } from './metrics-registry.service';

describe('NotificationsMetricsCollector', () => {
  let registry: MetricsRegistryService;
  let collector: NotificationsMetricsCollector;

  beforeEach(() => {
    registry = createTestMetricsRegistry();
    collector = new NotificationsMetricsCollector(registry);
  });

  const scrape = () => registry.render();

  it('declares every notification family (TYPE/HELP lines emitted even with no samples)', async () => {
    const out = await scrape();
    expect(out).toContain('# TYPE tasker_notification_delivered_total counter');
    expect(out).toContain('# TYPE tasker_push_subscriptions_cleaned_total counter');
  });

  it('counts deliveries per (channel, event, result)', async () => {
    collector.incrementDelivered('IN_APP', 'TASK_ASSIGNED', 'success');
    collector.incrementDelivered('IN_APP', 'TASK_ASSIGNED', 'success');
    collector.incrementDelivered('EMAIL', 'TASK_ASSIGNED', 'success');
    collector.incrementDelivered('EMAIL', 'TASK_ASSIGNED', 'failure');
    collector.incrementDelivered('PUSH', 'COMMENT_MENTION', 'success');
    const out = await scrape();
    expect(out).toContain(
      'tasker_notification_delivered_total{channel="IN_APP",event_type="TASK_ASSIGNED",result="success"} 2',
    );
    expect(out).toContain(
      'tasker_notification_delivered_total{channel="EMAIL",event_type="TASK_ASSIGNED",result="success"} 1',
    );
    expect(out).toContain(
      'tasker_notification_delivered_total{channel="EMAIL",event_type="TASK_ASSIGNED",result="failure"} 1',
    );
    expect(out).toContain(
      'tasker_notification_delivered_total{channel="PUSH",event_type="COMMENT_MENTION",result="success"} 1',
    );
  });

  it('separates push cleanup reasons', async () => {
    collector.incrementPushCleaned('gone');
    collector.incrementPushCleaned('gone');
    collector.incrementPushCleaned('dormant');
    const out = await scrape();
    expect(out).toContain('tasker_push_subscriptions_cleaned_total{reason="gone"} 2');
    expect(out).toContain('tasker_push_subscriptions_cleaned_total{reason="dormant"} 1');
  });
});
