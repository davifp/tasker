import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsController } from './metrics.controller';
import { PlanningMetricsCollector } from './planning.metrics';
import { SearchAuditMetricsCollector } from './search-audit.metrics';

describe('MetricsController', () => {
  let planning: PlanningMetricsCollector;
  let searchAudit: SearchAuditMetricsCollector;
  let controller: MetricsController;

  beforeEach(() => {
    planning = new PlanningMetricsCollector();
    searchAudit = new SearchAuditMetricsCollector();
    controller = new MetricsController(planning, searchAudit);
  });

  it('concatenates output from both collectors', () => {
    planning.incrementSprintTransition('PLANNED', 'ACTIVE');
    planning.incrementEpicWrite('created');
    searchAudit.incrementSearchQuery('task', 'success');
    searchAudit.incrementAuditWrite('task.created', 'success');

    const body = controller.scrape();
    expect(body).toContain('tasker_sprint_transition_total{from="PLANNED",to="ACTIVE"} 1');
    expect(body).toContain('tasker_epic_write_total{action="created"} 1');
    expect(body).toContain('tasker_search_query_total{type_set="task",outcome="success"} 1');
    expect(body).toContain('tasker_audit_write_total{event="task.created",outcome="success"} 1');
    expect(body.endsWith('\n')).toBe(true);
  });
});
