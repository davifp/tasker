import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SearchAuditMetricsCollector } from '../metrics/search-audit.metrics';
import { maskSensitiveMetadata } from './mask-sensitive';

export interface AuditListFilter {
  workspaceId: string;
  actorUserId?: string;
  event?: string[];
  targetType?: string[];
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

export interface AuditRow {
  id: string;
  workspaceId: string | null;
  actorUserId: string | null;
  actor?: { id: string; displayName: string; email: string } | null;
  event: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Prisma.JsonValue;
  traceId: string | null;
  createdAt: Date;
}

export interface AuditListResult {
  rows: AuditRow[];
  nextCursor: string | null;
}

interface CursorPayload {
  c: string; // createdAt ISO
  i: string; // id
}

// Read side of the AuditLog surface. Writes still flow through
// `common/audit/audit.service.ts` — this module owns pagination, filter
// composition, and sensitive-value masking at read time. Every query is scoped
// by `workspaceId` from the guarded controller context.
@Injectable()
export class AuditReadService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly metrics?: SearchAuditMetricsCollector,
  ) {}

  async list(filter: AuditListFilter): Promise<AuditListResult> {
    const started = Date.now();
    const hasFilter = Boolean(
      filter.actorUserId ||
      filter.event?.length ||
      filter.targetType?.length ||
      filter.from ||
      filter.to,
    );
    const cursor = this.decodeCursor(filter.cursor);
    const where = this.buildWhere(filter, cursor);

    const rowsPlusOne = await this.prisma.forSystem().auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      include: {
        actor: { select: { id: true, displayName: true, email: true } },
      },
    });

    const hasMore = rowsPlusOne.length > filter.limit;
    const rows = rowsPlusOne.slice(0, filter.limit).map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      actorUserId: r.actorUserId,
      actor: r.actor
        ? { id: r.actor.id, displayName: r.actor.displayName, email: r.actor.email }
        : null,
      event: r.event,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: maskSensitiveMetadata(r.metadata),
      traceId: r.traceId,
      createdAt: r.createdAt,
    }));

    const last = rows[rows.length - 1];
    const nextCursor =
      hasMore && last ? this.encodeCursor({ c: last.createdAt.toISOString(), i: last.id }) : null;

    this.metrics?.observeAuditReadMs(hasFilter, Date.now() - started);
    return { rows, nextCursor };
  }

  /**
   * Streams matching audit rows into an async generator without materializing
   * the full result set in memory. Consumer is responsible for enforcing the
   * row cap and formatting; see `AuditCsvExporter`.
   */
  async *stream(
    filter: Omit<AuditListFilter, 'cursor' | 'limit'>,
    batchSize = 500,
  ): AsyncGenerator<AuditRow, void, unknown> {
    let cursor: CursorPayload | undefined;
    while (true) {
      const where = this.buildWhere(filter, cursor);
      const batch = await this.prisma.forSystem().auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: batchSize,
        include: {
          actor: { select: { id: true, displayName: true, email: true } },
        },
      });
      if (batch.length === 0) return;
      for (const r of batch) {
        yield {
          id: r.id,
          workspaceId: r.workspaceId,
          actorUserId: r.actorUserId,
          actor: r.actor
            ? { id: r.actor.id, displayName: r.actor.displayName, email: r.actor.email }
            : null,
          event: r.event,
          targetType: r.targetType,
          targetId: r.targetId,
          metadata: maskSensitiveMetadata(r.metadata),
          traceId: r.traceId,
          createdAt: r.createdAt,
        };
      }
      const last = batch[batch.length - 1];
      if (!last || batch.length < batchSize) return;
      cursor = { c: last.createdAt.toISOString(), i: last.id };
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildWhere(
    filter: Omit<AuditListFilter, 'cursor' | 'limit'>,
    cursor: CursorPayload | undefined,
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { workspaceId: filter.workspaceId };
    if (filter.actorUserId) where.actorUserId = filter.actorUserId;
    if (filter.event && filter.event.length > 0) where.event = { in: filter.event };
    if (filter.targetType && filter.targetType.length > 0) {
      where.targetType = { in: filter.targetType };
    }
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }
    if (cursor) {
      // Descending order on (createdAt, id) — the next page is anything
      // strictly older, breaking ties by id.
      const cursorDate = new Date(cursor.c);
      where.OR = [
        { createdAt: { lt: cursorDate } },
        { createdAt: cursorDate, id: { lt: cursor.i } },
      ];
    }
    return where;
  }

  private encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  private decodeCursor(raw?: string): CursorPayload | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CursorPayload;
      if (typeof parsed.c !== 'string' || typeof parsed.i !== 'string') return undefined;
      if (Number.isNaN(new Date(parsed.c).getTime())) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }
}
