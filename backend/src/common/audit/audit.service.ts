import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TraceContext } from '../trace/trace-context';
import { AuditEventName } from './audit.events';

export interface AuditEntry {
  event: AuditEventName;
  actorUserId?: string;
  workspaceId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
}

// Writes AuditLog rows. All security-relevant flows funnel through this service
// so the AuditLog schema and trace-id enrichment stay in one place. Writes are
// best-effort: a failure here must never bubble up and fail the originating
// request (audit is observability, not correctness).
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.forSystem().auditLog.create({
        data: {
          event: entry.event,
          actorUserId: entry.actorUserId ?? null,
          workspaceId: entry.workspaceId ?? null,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          metadata: entry.metadata ?? {},
          traceId: TraceContext.get() ?? null,
        },
      });
    } catch (err) {
      this.logger.warn({ err, event: entry.event }, 'Failed to persist audit log entry');
    }
  }
}
