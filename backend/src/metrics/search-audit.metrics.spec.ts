import { describe, it, expect, beforeEach } from 'vitest';
import { SearchAuditMetricsCollector } from './search-audit.metrics';
import { createTestMetricsRegistry } from './metrics-registry.test-helpers';
import type { MetricsRegistryService } from './metrics-registry.service';

describe('SearchAuditMetricsCollector', () => {
  let registry: MetricsRegistryService;
  let collector: SearchAuditMetricsCollector;

  beforeEach(() => {
    registry = createTestMetricsRegistry();
    collector = new SearchAuditMetricsCollector(registry);
  });

  const scrape = () => registry.render();

  it('declares every search/audit family (TYPE/HELP lines emitted even with no samples)', async () => {
    const out = await scrape();
    expect(out).toContain('# TYPE tasker_search_query_duration_ms histogram');
    expect(out).toContain('# TYPE tasker_audit_write_total counter');
  });

  it('increments search query totals with labels', async () => {
    collector.incrementSearchQuery('task', 'success');
    collector.incrementSearchQuery('task', 'success');
    collector.incrementSearchQuery('task', 'error');
    const out = await scrape();
    expect(out).toContain('tasker_search_query_total{type_set="task",outcome="success"} 2');
    expect(out).toContain('tasker_search_query_total{type_set="task",outcome="error"} 1');
  });

  it('emits histogram buckets + count + sum for observed durations', async () => {
    for (let ms = 10; ms <= 100; ms += 10) {
      collector.observeSearchQueryMs('task,project', false, ms);
    }
    const out = await scrape();
    expect(out).toMatch(/tasker_search_query_duration_ms_bucket\{[^}]*le="/);
    expect(out).toMatch(/tasker_search_query_duration_ms_count\{[^}]*\} 10/);
    expect(out).toMatch(/tasker_search_query_duration_ms_sum/);
  });

  it('increments audit write totals per (event, outcome)', async () => {
    collector.incrementAuditWrite('task.created', 'success');
    collector.incrementAuditWrite('task.created', 'failure');
    collector.incrementAuditWrite('project.updated', 'success');
    const out = await scrape();
    expect(out).toContain('tasker_audit_write_total{event="task.created",outcome="success"} 1');
    expect(out).toContain('tasker_audit_write_total{event="task.created",outcome="failure"} 1');
    expect(out).toContain('tasker_audit_write_total{event="project.updated",outcome="success"} 1');
  });

  it('separates CSV export totals by cap status', async () => {
    collector.incrementAuditCsvExport(false);
    collector.incrementAuditCsvExport(false);
    collector.incrementAuditCsvExport(true);
    const out = await scrape();
    expect(out).toContain('tasker_audit_csv_export_total{capped="no"} 2');
    expect(out).toContain('tasker_audit_csv_export_total{capped="yes"} 1');
  });

  it('tracks zero-result queries per type set', async () => {
    collector.incrementSearchZeroResult('member');
    const out = await scrape();
    expect(out).toContain('tasker_search_zero_result_total{type_set="member"} 1');
  });

  it('handles bursty observations without unbounded memory (prom-client uses fixed-bucket histograms)', async () => {
    for (let i = 0; i < 600; i++) collector.observeAuditReadMs(false, i);
    const out = await scrape();
    expect(out).toMatch(/tasker_audit_read_duration_ms_count\{[^}]*\} 600/);
  });
});
