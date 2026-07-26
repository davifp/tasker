import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsController } from './metrics.controller';
import { PlanningMetricsCollector } from './planning.metrics';

describe('MetricsController', () => {
  let collector: PlanningMetricsCollector;
  let controller: MetricsController;

  beforeEach(() => {
    collector = new PlanningMetricsCollector();
    controller = new MetricsController(collector);
  });

  it('returns the collector render output verbatim', () => {
    collector.incrementSprintTransition('PLANNED', 'ACTIVE');
    collector.incrementEpicWrite('created');

    const body = controller.scrape();
    expect(body).toContain('tasker_sprint_transition_total{from="PLANNED",to="ACTIVE"} 1');
    expect(body).toContain('tasker_epic_write_total{action="created"} 1');
    // Content is line-oriented Prometheus text; the render trails with a newline.
    expect(body.endsWith('\n')).toBe(true);
  });
});
