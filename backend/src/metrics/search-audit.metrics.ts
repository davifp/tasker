import { Injectable } from '@nestjs/common';
import type { Counter, Histogram } from 'prom-client';
import { MetricsRegistryService } from './metrics-registry.service';

const QUERY_MS_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const AUDIT_READ_MS_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500];
const CSV_ROWS_BUCKETS = [10, 100, 1000, 10_000, 100_000];

@Injectable()
export class SearchAuditMetricsCollector {
  private readonly searchQueryDurationMs: Histogram<'type_set' | 'has_filter'>;
  private readonly searchQueryTotal: Counter<'type_set' | 'outcome'>;
  private readonly searchZeroResultTotal: Counter<'type_set'>;
  private readonly auditWriteTotal: Counter<'event' | 'outcome'>;
  private readonly auditReadDurationMs: Histogram<'has_filter'>;
  private readonly auditCsvExportTotal: Counter<'capped'>;
  private readonly auditCsvExportRows: Histogram<never>;

  constructor(registry: MetricsRegistryService) {
    this.searchQueryDurationMs = registry.histogram({
      name: 'tasker_search_query_duration_ms',
      help: 'Search query latency in ms.',
      labelNames: ['type_set', 'has_filter'] as const,
      buckets: QUERY_MS_BUCKETS,
    });
    this.searchQueryTotal = registry.counter({
      name: 'tasker_search_query_total',
      help: 'Search queries executed.',
      labelNames: ['type_set', 'outcome'] as const,
    });
    this.searchZeroResultTotal = registry.counter({
      name: 'tasker_search_zero_result_total',
      help: 'Search queries that returned no hits.',
      labelNames: ['type_set'] as const,
    });
    this.auditWriteTotal = registry.counter({
      name: 'tasker_audit_write_total',
      help: 'AuditLog rows written.',
      labelNames: ['event', 'outcome'] as const,
    });
    this.auditReadDurationMs = registry.histogram({
      name: 'tasker_audit_read_duration_ms',
      help: 'Audit read latency in ms.',
      labelNames: ['has_filter'] as const,
      buckets: AUDIT_READ_MS_BUCKETS,
    });
    this.auditCsvExportTotal = registry.counter({
      name: 'tasker_audit_csv_export_total',
      help: 'Audit CSV exports performed.',
      labelNames: ['capped'] as const,
    });
    this.auditCsvExportRows = registry.histogram({
      name: 'tasker_audit_csv_export_rows',
      help: 'Rows emitted per CSV export.',
      buckets: CSV_ROWS_BUCKETS,
    });
  }

  observeSearchQueryMs(typeSet: string, hasFilter: boolean, ms: number): void {
    this.searchQueryDurationMs.observe(
      { type_set: typeSet, has_filter: hasFilter ? 'yes' : 'no' },
      ms,
    );
  }

  incrementSearchQuery(typeSet: string, outcome: 'success' | 'error'): void {
    this.searchQueryTotal.inc({ type_set: typeSet, outcome });
  }

  incrementSearchZeroResult(typeSet: string): void {
    this.searchZeroResultTotal.inc({ type_set: typeSet });
  }

  incrementAuditWrite(event: string, outcome: 'success' | 'failure'): void {
    this.auditWriteTotal.inc({ event, outcome });
  }

  observeAuditReadMs(hasFilter: boolean, ms: number): void {
    this.auditReadDurationMs.observe({ has_filter: hasFilter ? 'yes' : 'no' }, ms);
  }

  incrementAuditCsvExport(capped: boolean): void {
    this.auditCsvExportTotal.inc({ capped: capped ? 'yes' : 'no' });
  }

  observeAuditCsvExportRows(rows: number): void {
    this.auditCsvExportRows.observe(rows);
  }
}
