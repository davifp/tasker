import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { AuditCsvExporter } from './audit-csv.exporter';
import type { AuditReadService, AuditRow } from './audit-read.service';

function collectingStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, text: () => chunks.join('') };
}

function makeRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'row-1',
    workspaceId: 'ws-1',
    actorUserId: 'user-1',
    actor: { id: 'user-1', displayName: 'Owner O', email: 'o@t.test' },
    event: 'task.created',
    targetType: 'task',
    targetId: 'task-42',
    metadata: { title: 'A task', password: '[masked]' },
    traceId: 'trace-abc',
    createdAt: new Date('2026-07-26T10:00:00.000Z'),
    ...overrides,
  };
}

function fakeReadsFromRows(rows: AuditRow[]): AuditReadService {
  return {
    async *stream() {
      for (const row of rows) yield row;
    },
    list: async () => ({ rows: [], nextCursor: null }),
  } as unknown as AuditReadService;
}

describe('AuditCsvExporter', () => {
  it('writes header + all rows when under the cap', async () => {
    const reads = fakeReadsFromRows([makeRow(), makeRow({ id: 'row-2', event: 'task.updated' })]);
    const exporter = new AuditCsvExporter(reads);
    const { stream, text } = collectingStream();

    const result = await exporter.stream({ workspaceId: 'ws-1' }, stream);

    expect(result.rows).toBe(2);
    expect(result.capped).toBe(false);
    const body = text();
    expect(body.startsWith('id,createdAt,workspaceId,')).toBe(true);
    expect(body).toContain('task.created');
    expect(body).toContain('task.updated');
    expect(body).not.toContain('# capped');
  });

  it('doubles quotes inside cells to keep CSV parseable', async () => {
    const reads = fakeReadsFromRows([makeRow({ metadata: { note: 'She said "yes" and left' } })]);
    const exporter = new AuditCsvExporter(reads);
    const { stream, text } = collectingStream();
    await exporter.stream({ workspaceId: 'ws-1' }, stream);
    const body = text();
    // JSON.stringify produces \" which then becomes \"" after CSV escape.
    expect(body).toContain('\\""yes\\""');
    // Overall the metadata cell must open and close with a double quote so
    // downstream parsers treat it as one cell.
    const lastLine = body.trim().split('\n').pop()!;
    const lastCell = lastLine.split(',').slice(10).join(','); // metadata is col 11
    expect(lastCell.startsWith('"')).toBe(true);
    expect(lastCell.endsWith('"')).toBe(true);
  });

  it('handles null actor gracefully (system events)', async () => {
    const reads = fakeReadsFromRows([
      makeRow({ actorUserId: null, actor: null, event: 'workspace.deleted' }),
    ]);
    const exporter = new AuditCsvExporter(reads);
    const { stream, text } = collectingStream();
    await exporter.stream({ workspaceId: 'ws-1' }, stream);
    expect(text()).toContain(',,,'); // three empty cells for actorUserId/name/email
  });
});
