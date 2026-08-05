import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsController } from './metrics.controller';
import { PlanningMetricsCollector } from './planning.metrics';
import { SearchAuditMetricsCollector } from './search-audit.metrics';
import { RealtimeMetricsCollector } from './realtime.metrics';
import { NotificationsMetricsCollector } from './notifications.metrics';
import { AiMetricsCollector } from '../ai/metrics/ai.metrics';
import { IntegrationMetricsCollector } from '../platform/integrations/integration.metrics';
import { RateLimitMetricsCollector } from '../platform/rate-limiting/rate-limit.metrics';
import { WebhookMetricsCollector } from '../platform/webhooks/webhook.metrics';

describe('MetricsController', () => {
  let planning: PlanningMetricsCollector;
  let searchAudit: SearchAuditMetricsCollector;
  let realtime: RealtimeMetricsCollector;
  let notifications: NotificationsMetricsCollector;
  let ai: AiMetricsCollector;
  let rateLimit: RateLimitMetricsCollector;
  let webhooks: WebhookMetricsCollector;
  let integrations: IntegrationMetricsCollector;
  let controller: MetricsController;

  beforeEach(() => {
    planning = new PlanningMetricsCollector();
    searchAudit = new SearchAuditMetricsCollector();
    realtime = new RealtimeMetricsCollector();
    notifications = new NotificationsMetricsCollector();
    ai = new AiMetricsCollector();
    rateLimit = new RateLimitMetricsCollector();
    webhooks = new WebhookMetricsCollector();
    integrations = new IntegrationMetricsCollector();
    controller = new MetricsController(
      planning,
      searchAudit,
      realtime,
      notifications,
      ai,
      rateLimit,
      webhooks,
      integrations,
    );
  });

  it('concatenates output from every collector', () => {
    planning.incrementSprintTransition('PLANNED', 'ACTIVE');
    planning.incrementEpicWrite('created');
    searchAudit.incrementSearchQuery('task', 'success');
    searchAudit.incrementAuditWrite('task.created', 'success');
    realtime.incrementConnect('success');
    realtime.incrementEvent('task.updated', 'success');
    notifications.incrementDelivered('IN_APP', 'TASK_ASSIGNED', 'success');
    notifications.incrementPushCleaned('gone');
    ai.incrementInvocation('GENERATE_DESCRIPTION', 'anthropic', 'claude-sonnet-4-6', 'OK');
    rateLimit.incrementRequest('tsk_live', 200);
    rateLimit.incrementRateLimitHit('tsk_live');
    webhooks.incrementDelivery('success');
    webhooks.observeLatency('success', 0.123);
    integrations.incrementSync('GITHUB', 'success');
    integrations.incrementConnection('GITHUB', 'connected');

    const body = controller.scrape();
    expect(body).toContain('tasker_sprint_transition_total{from="PLANNED",to="ACTIVE"} 1');
    expect(body).toContain('tasker_epic_write_total{action="created"} 1');
    expect(body).toContain('tasker_search_query_total{type_set="task",outcome="success"} 1');
    expect(body).toContain('tasker_audit_write_total{event="task.created",outcome="success"} 1');
    expect(body).toMatch(/tasker_realtime_connects_total\{result="success",[^}]*\} 1/);
    expect(body).toMatch(
      /tasker_realtime_events_total\{type="task\.updated",result="success",[^}]*\} 1/,
    );
    expect(body).toContain(
      'tasker_notification_delivered_total{channel="IN_APP",event_type="TASK_ASSIGNED",result="success"} 1',
    );
    expect(body).toContain('tasker_push_subscriptions_cleaned_total{reason="gone"} 1');
    expect(body).toContain(
      'tasker_ai_invocations_total{action="GENERATE_DESCRIPTION",provider="anthropic",model="claude-sonnet-4-6",status="OK"} 1',
    );
    expect(body).toContain('platform_api_requests_total{key_prefix="tsk_live",status="200"} 1');
    expect(body).toContain('platform_api_ratelimit_hits_total{key_prefix="tsk_live"} 1');
    expect(body).toContain('platform_webhook_delivery_total{outcome="success"} 1');
    expect(body).toContain('platform_webhook_delivery_latency_seconds_count{outcome="success"} 1');
    expect(body).toContain(
      'platform_integration_syncs_total{provider="GITHUB",outcome="success"} 1',
    );
    expect(body).toContain(
      'platform_integration_connections_total{provider="GITHUB",outcome="connected"} 1',
    );
    expect(body.endsWith('\n')).toBe(true);
  });
});
