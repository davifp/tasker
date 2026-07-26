import { Controller, ForbiddenException, Get, Param, Query, Request, Res } from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { Roles } from '../common/context/roles.decorator';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { AuditService } from '../common/audit/audit.service';
import { AuditEvent } from '../common/audit/audit.events';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AuditReadService } from './audit-read.service';
import { AuditCsvExporter } from './audit-csv.exporter';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug/audit')
@Roles('ADMIN')
export class AuditController {
  constructor(
    private readonly reads: AuditReadService,
    private readonly exporter: AuditCsvExporter,
    private readonly audits: AuditService,
  ) {}

  @Get()
  async list(
    @Query() query: AuditQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.reads.list({
      workspaceId: ctx.workspaceId,
      actorUserId: query.actorUserId,
      event: query.event,
      targetType: query.targetType,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('export.csv')
  async exportCsv(
    @Param('slug') slug: string,
    @Query() query: AuditQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const ctx = requireCtx(req);
    const stamp = timestamp();
    const filename = `audit-${slug}-${stamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const result = await this.exporter.stream(
      {
        workspaceId: ctx.workspaceId,
        actorUserId: query.actorUserId,
        event: query.event,
        targetType: query.targetType,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      res,
    );

    if (result.capped) {
      res.setHeader('X-Audit-Export-Capped', 'true');
    }
    res.end();

    // Audit the auditor. Best-effort; AuditService swallows failures.
    await this.audits.record({
      event: AuditEvent.AUDIT_EXPORT,
      actorUserId: ctx.userId,
      workspaceId: ctx.workspaceId,
      targetType: 'audit',
      metadata: {
        rows: result.rows,
        capped: result.capped,
        filters: {
          actorUserId: query.actorUserId ?? null,
          event: query.event ?? null,
          targetType: query.targetType ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
        },
      },
    });
  }
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    '-' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds())
  );
}
