import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsController } from './metrics.controller';
import { PlanningMetricsCollector } from './planning.metrics';
import { SearchAuditMetricsCollector } from './search-audit.metrics';
import { RealtimeMetricsCollector } from './realtime.metrics';
import { NotificationsMetricsCollector } from './notifications.metrics';

describe('MetricsController', () => {
  let planning: PlanningMetricsCollector;
  let searchAudit: SearchAuditMetricsCollector;
  let realtime: RealtimeMetricsCollector;
  let notifications: NotificationsMetricsCollector;
  let controller: MetricsController;

  beforeEach(() => {
    planning = new PlanningMetricsCollector();
    searchAudit = new SearchAuditMetricsCollector();
    realtime = new RealtimeMetricsCollector();
    notifications = new NotificationsMetricsCollector();
    controller = new MetricsController(planning, searchAudit, realtime, notifications);
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
    expect(body.endsWith('\n')).toBe(true);
  });
});
