import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationsMetricsCollector } from './notifications.metrics';

describe('NotificationsMetricsCollector', () => {
  let collector: NotificationsMetricsCollector;

  beforeEach(() => {
    collector = new NotificationsMetricsCollector();
  });

  it('renders empty scrape output with all metric families declared', () => {
    const out = collector.render();
    expect(out).toContain('tasker_notification_delivered_total');
    expect(out).toContain('tasker_push_subscriptions_cleaned_total');
  });

  it('counts deliveries per (channel, event, result)', () => {
    collector.incrementDelivered('IN_APP', 'TASK_ASSIGNED', 'success');
    collector.incrementDelivered('IN_APP', 'TASK_ASSIGNED', 'success');
    collector.incrementDelivered('EMAIL', 'TASK_ASSIGNED', 'success');
    collector.incrementDelivered('EMAIL', 'TASK_ASSIGNED', 'failure');
    collector.incrementDelivered('PUSH', 'COMMENT_MENTION', 'success');
    const out = collector.render();
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

  it('separates push cleanup reasons', () => {
    collector.incrementPushCleaned('gone');
    collector.incrementPushCleaned('gone');
    collector.incrementPushCleaned('dormant');
    const out = collector.render();
    expect(out).toContain('tasker_push_subscriptions_cleaned_total{reason="gone"} 2');
    expect(out).toContain('tasker_push_subscriptions_cleaned_total{reason="dormant"} 1');
  });

  it('snapshot exposes internal maps for assertions', () => {
    collector.incrementDelivered('IN_APP', 'COMMENT_MENTION', 'success');
    collector.incrementPushCleaned('gone');
    const snap = collector.snapshot();
    expect(snap.deliveredTotal).toEqual({ 'IN_APP|COMMENT_MENTION|success': 1 });
    expect(snap.pushCleanedTotal).toEqual({ gone: 1 });
  });
});
