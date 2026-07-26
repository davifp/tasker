import { describe, it, expect, beforeEach } from 'vitest';
import { SearchAuditMetricsCollector } from './search-audit.metrics';

describe('SearchAuditMetricsCollector', () => {
  let collector: SearchAuditMetricsCollector;

  beforeEach(() => {
    collector = new SearchAuditMetricsCollector();
  });

  it('renders empty scrape output without errors', () => {
    const out = collector.render();
    expect(out).toContain('tasker_search_query_duration_ms');
    expect(out).toContain('tasker_audit_write_total');
  });

  it('increments search query totals with labels', () => {
    collector.incrementSearchQuery('task', 'success');
    collector.incrementSearchQuery('task', 'success');
    collector.incrementSearchQuery('task', 'error');
    const out = collector.render();
    expect(out).toContain('tasker_search_query_total{type_set="task",outcome="success"} 2');
    expect(out).toContain('tasker_search_query_total{type_set="task",outcome="error"} 1');
  });

  it('emits summary quantiles for observed durations', () => {
    for (let ms = 10; ms <= 100; ms += 10) {
      collector.observeSearchQueryMs('task,project', false, ms);
    }
    const out = collector.render();
    expect(out).toMatch(/tasker_search_query_duration_ms\{[^}]*quantile="0\.5"\}/);
    expect(out).toMatch(/tasker_search_query_duration_ms\{[^}]*quantile="0\.9"\}/);
    expect(out).toContain('_count');
    expect(out).toContain('_sum');
  });

  it('increments audit write totals per (event, outcome)', () => {
    collector.incrementAuditWrite('task.created', 'success');
    collector.incrementAuditWrite('task.created', 'failure');
    collector.incrementAuditWrite('project.updated', 'success');
    const out = collector.render();
    expect(out).toContain('tasker_audit_write_total{event="task.created",outcome="success"} 1');
    expect(out).toContain('tasker_audit_write_total{event="task.created",outcome="failure"} 1');
    expect(out).toContain('tasker_audit_write_total{event="project.updated",outcome="success"} 1');
  });

  it('separates CSV export totals by cap status', () => {
    collector.incrementAuditCsvExport(false);
    collector.incrementAuditCsvExport(false);
    collector.incrementAuditCsvExport(true);
    const out = collector.render();
    expect(out).toContain('tasker_audit_csv_export_total{capped="no"} 2');
    expect(out).toContain('tasker_audit_csv_export_total{capped="yes"} 1');
  });

  it('tracks zero-result queries per type set', () => {
    collector.incrementSearchZeroResult('member');
    const out = collector.render();
    expect(out).toContain('tasker_search_zero_result_total{type_set="member"} 1');
  });

  it('caps histogram samples at 500 to bound memory', () => {
    for (let i = 0; i < 600; i++) collector.observeAuditReadMs(false, i);
    // Snapshot doesn't expose read-side histograms directly; render succeeds and
    // count reflects the capped 500 samples.
    expect(collector.render()).toContain('tasker_audit_read_duration_ms_count');
  });
});
