import { Controller, ForbiddenException, Get, Query, Request } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { RoadmapQueryDto } from './dto/roadmap-query.dto';
import { EpicsService } from './epics.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

/**
 * Workspace-scoped quarterly roadmap read. All members (Owner/Admin/Member)
 * can read; writes go through `EpicsController` which is Admin-gated.
 */
@Controller('workspaces/:slug/roadmap')
export class RoadmapController {
  constructor(private readonly epics: EpicsService) {}

  @Get()
  async list(
    @Query() query: RoadmapQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const epics = await this.epics.roadmap({
      workspaceId: ctx.workspaceId,
      fromQuarter: query.fromQuarter,
      toQuarter: query.toQuarter,
      projectId: query.projectId,
    });
    return { items: epics };
  }
}
