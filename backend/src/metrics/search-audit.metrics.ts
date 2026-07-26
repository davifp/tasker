import { Injectable } from '@nestjs/common';

// In-house Prometheus collector for the Search & Audit surface (Phase 7).
// Follows the same shape as `PlanningMetricsCollector`: `observe*` /
// `increment*` methods for callers, `render()` for the scrape endpoint.
// A future rewrite around `prom-client` stays purely additive because the
// metric names and labels defined here are the contract.

const HISTOGRAM_MAX_SAMPLES = 500;

interface Histogram {
  samples: number[];
  observe(value: number): void;
}

function makeHistogram(): Histogram {
  const samples: number[] = [];
  return {
    samples,
    observe(value: number) {
      samples.push(value);
      if (samples.length > HISTOGRAM_MAX_SAMPLES) samples.shift();
    },
  };
}

@Injectable()
export class SearchAuditMetricsCollector {
  private readonly searchQueryDurationMs = new Map<string, Histogram>();
  private readonly searchQueryTotal = new Map<string, number>();
  private readonly searchZeroResultTotal = new Map<string, number>();
  private readonly auditWriteTotal = new Map<string, number>();
  private readonly auditReadDurationMs = new Map<string, Histogram>();
  private readonly auditCsvExportTotal = new Map<string, number>();
  private readonly auditCsvExportRows = makeHistogram();

  // -------------------------------------------------------------------------
  // Emit
  // -------------------------------------------------------------------------

  observeSearchQueryMs(typeSet: string, hasFilter: boolean, ms: number): void {
    const key = `${typeSet}|${hasFilter ? 'yes' : 'no'}`;
    const h = this.searchQueryDurationMs.get(key) ?? makeHistogram();
    h.observe(ms);
    this.searchQueryDurationMs.set(key, h);
  }

  incrementSearchQuery(typeSet: string, outcome: 'success' | 'error'): void {
    const key = `${typeSet}|${outcome}`;
    this.searchQueryTotal.set(key, (this.searchQueryTotal.get(key) ?? 0) + 1);
  }

  incrementSearchZeroResult(typeSet: string): void {
    this.searchZeroResultTotal.set(typeSet, (this.searchZeroResultTotal.get(typeSet) ?? 0) + 1);
  }

  incrementAuditWrite(event: string, outcome: 'success' | 'failure'): void {
    const key = `${event}|${outcome}`;
    this.auditWriteTotal.set(key, (this.auditWriteTotal.get(key) ?? 0) + 1);
  }

  observeAuditReadMs(hasFilter: boolean, ms: number): void {
    const key = hasFilter ? 'yes' : 'no';
    const h = this.auditReadDurationMs.get(key) ?? makeHistogram();
    h.observe(ms);
    this.auditReadDurationMs.set(key, h);
  }

  incrementAuditCsvExport(capped: boolean): void {
    const key = capped ? 'yes' : 'no';
    this.auditCsvExportTotal.set(key, (this.auditCsvExportTotal.get(key) ?? 0) + 1);
  }

  observeAuditCsvExportRows(rows: number): void {
    this.auditCsvExportRows.observe(rows);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  render(): string {
    const lines: string[] = [];

    lines.push('# HELP tasker_search_query_duration_ms Search query latency in ms.');
    lines.push('# TYPE tasker_search_query_duration_ms summary');
    for (const [key, hist] of this.searchQueryDurationMs) {
      const [type_set, has_filter] = key.split('|');
      lines.push(
        ...summaryLines(
          'tasker_search_query_duration_ms',
          { type_set: type_set!, has_filter: has_filter! },
          hist.samples,
        ),
      );
    }

    lines.push('# HELP tasker_search_query_total Search queries executed.');
    lines.push('# TYPE tasker_search_query_total counter');
    for (const [key, value] of this.searchQueryTotal) {
      const [type_set, outcome] = key.split('|');
      lines.push(`tasker_search_query_total{type_set="${type_set}",outcome="${outcome}"} ${value}`);
    }

    lines.push('# HELP tasker_search_zero_result_total Search queries that returned no hits.');
    lines.push('# TYPE tasker_search_zero_result_total counter');
    for (const [key, value] of this.searchZeroResultTotal) {
      lines.push(`tasker_search_zero_result_total{type_set="${key}"} ${value}`);
    }

    lines.push('# HELP tasker_audit_write_total AuditLog rows written.');
    lines.push('# TYPE tasker_audit_write_total counter');
    for (const [key, value] of this.auditWriteTotal) {
      const [event, outcome] = key.split('|');
      lines.push(`tasker_audit_write_total{event="${event}",outcome="${outcome}"} ${value}`);
    }

    lines.push('# HELP tasker_audit_read_duration_ms Audit read latency in ms.');
    lines.push('# TYPE tasker_audit_read_duration_ms summary');
    for (const [key, hist] of this.auditReadDurationMs) {
      lines.push(
        ...summaryLines('tasker_audit_read_duration_ms', { has_filter: key }, hist.samples),
      );
    }

    lines.push('# HELP tasker_audit_csv_export_total Audit CSV exports performed.');
    lines.push('# TYPE tasker_audit_csv_export_total counter');
    for (const [key, value] of this.auditCsvExportTotal) {
      lines.push(`tasker_audit_csv_export_total{capped="${key}"} ${value}`);
    }

    lines.push('# HELP tasker_audit_csv_export_rows Rows emitted per CSV export.');
    lines.push('# TYPE tasker_audit_csv_export_rows summary');
    lines.push(
      ...summaryLines('tasker_audit_csv_export_rows', {}, this.auditCsvExportRows.samples),
    );

    return lines.join('\n') + '\n';
  }

  snapshot() {
    return {
      searchQueryTotal: Object.fromEntries(this.searchQueryTotal),
      searchZeroResultTotal: Object.fromEntries(this.searchZeroResultTotal),
      auditWriteTotal: Object.fromEntries(this.auditWriteTotal),
      auditCsvExportTotal: Object.fromEntries(this.auditCsvExportTotal),
      auditCsvExportRows: [...this.auditCsvExportRows.samples],
    };
  }
}

function summaryLines(name: string, labels: Record<string, string>, samples: number[]): string[] {
  if (samples.length === 0) return [];
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  const prefix = labelStr ? `${labelStr},` : '';
  const sum = sorted.reduce((a, b) => a + b, 0);
  return [
    `${name}{${prefix}quantile="0.5"} ${p(0.5)}`,
    `${name}{${prefix}quantile="0.9"} ${p(0.9)}`,
    `${name}{${prefix}quantile="0.95"} ${p(0.95)}`,
    `${name}_sum{${labelStr}} ${sum}`,
    `${name}_count{${labelStr}} ${sorted.length}`,
  ];
}
