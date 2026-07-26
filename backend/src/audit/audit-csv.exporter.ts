import { Injectable, Optional } from '@nestjs/common';
import { Writable } from 'node:stream';
import { AUDIT_CSV_ROW_CAP } from '@tasker/config';
import { SearchAuditMetricsCollector } from '../metrics/search-audit.metrics';
import { AuditReadService, type AuditListFilter, type AuditRow } from './audit-read.service';

export interface CsvExportResult {
  rows: number;
  capped: boolean;
}

const HEADER = [
  'id',
  'createdAt',
  'workspaceId',
  'actorUserId',
  'actorDisplayName',
  'actorEmail',
  'event',
  'targetType',
  'targetId',
  'traceId',
  'metadata',
].join(',');

@Injectable()
export class AuditCsvExporter {
  constructor(
    private readonly reads: AuditReadService,
    @Optional() private readonly metrics?: SearchAuditMetricsCollector,
  ) {}

  /**
   * Streams audit rows matching the given filter as CSV. Emits at most
   * `AUDIT_CSV_ROW_CAP` rows and returns `{ rows, capped }` so the controller
   * can set `X-Audit-Export-Capped: true` on overflow. Metadata is serialized
   * as JSON in a single CSV cell (double-quoted, doubled-up quotes).
   */
  async stream(
    filter: Omit<AuditListFilter, 'cursor' | 'limit'>,
    out: Writable,
  ): Promise<CsvExportResult> {
    out.write(HEADER);
    out.write('\n');

    let count = 0;
    let capped = false;
    for await (const row of this.reads.stream(filter)) {
      if (count >= AUDIT_CSV_ROW_CAP) {
        capped = true;
        break;
      }
      out.write(this.formatRow(row));
      out.write('\n');
      count += 1;
    }

    if (capped) {
      out.write(`# capped=true, row_cap=${AUDIT_CSV_ROW_CAP}\n`);
    }

    this.metrics?.incrementAuditCsvExport(capped);
    this.metrics?.observeAuditCsvExportRows(count);
    return { rows: count, capped };
  }

  private formatRow(row: AuditRow): string {
    return [
      csv(row.id),
      csv(row.createdAt.toISOString()),
      csv(row.workspaceId),
      csv(row.actorUserId),
      csv(row.actor?.displayName ?? null),
      csv(row.actor?.email ?? null),
      csv(row.event),
      csv(row.targetType),
      csv(row.targetId),
      csv(row.traceId),
      csv(JSON.stringify(row.metadata ?? {})),
    ].join(',');
  }
}

function csv(value: string | null | undefined): string {
  if (value == null) return '';
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
