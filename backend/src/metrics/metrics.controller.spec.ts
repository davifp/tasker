import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsController } from './metrics.controller';
import { PlanningMetricsCollector } from './planning.metrics';
import { SearchAuditMetricsCollector } from './search-audit.metrics';
import { RealtimeMetricsCollector } from './realtime.metrics';
import { NotificationsMetricsCollector } from './notifications.metrics';
import { AiMetricsCollector } from '../ai/metrics/ai.metrics';

describe('MetricsController', () => {
  let planning: PlanningMetricsCollector;
  let searchAudit: SearchAuditMetricsCollector;
  let realtime: RealtimeMetricsCollector;
  let notifications: NotificationsMetricsCollector;
  let ai: AiMetricsCollector;
  let controller: MetricsController;

  beforeEach(() => {
    planning = new PlanningMetricsCollector();
    searchAudit = new SearchAuditMetricsCollector();
    realtime = new RealtimeMetricsCollector();
    notifications = new NotificationsMetricsCollector();
    ai = new AiMetricsCollector();
    controller = new MetricsController(planning, searchAudit, realtime, notifications, ai);
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
    expect(body.endsWith('\n')).toBe(true);
  });
});
