import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Idempotent } from '../common/idempotency/idempotency.decorators';
import { Roles } from '../common/context/roles.decorator';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { PrismaService } from '../prisma/prisma.service';
import { SprintsService } from '../sprints/sprints.service';
import { CycleLeadTimeQueryDto } from './dto/cycle-lead-time-query.dto';
import { BurndownQueryDto } from './dto/burndown-query.dto';
import { DashboardRefreshDto } from './dto/dashboard-refresh.dto';
import { MetricsService } from './metrics.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug')
export class DashboardController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly sprints: SprintsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('projects/:projectSlug/sprints/:sprintNumber/burndown')
  async burndown(
    @Param('projectSlug') projectSlug: string,
    @Param('sprintNumber', ParseIntPipe) sprintNumber: number,
    @Query() _query: BurndownQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    const sprint = await this.sprints.findByNumber(ctx.workspaceId, project.id, sprintNumber);
    if (!sprint) throw new NotFoundException('Sprint not found');
    return this.metrics.burndown(ctx.workspaceId, sprint.id);
  }

  @Get('dashboard/cycle-lead-time')
  async cycleLeadTime(
    @Query() query: CycleLeadTimeQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.metrics.cycleLeadTime(ctx.workspaceId, {
      window: query.window,
      from: query.from,
      to: query.to,
      projectId: query.projectId,
    });
  }

  @Get('dashboard/sprint-close/:sprintId')
  async sprintClose(
    @Param('sprintId') sprintId: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const summary = await this.sprints.closeSummary(ctx.workspaceId, sprintId);
    return { data: summary, asOf: null };
  }

  @Post('dashboard/refresh')
  @Idempotent()
  @Roles('OWNER')
  async refresh(
    @Body() _body: DashboardRefreshDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.metrics.triggerRefresh(ctx.workspaceId);
    return { queued: true };
  }

  private async resolveProject(workspaceId: string, projectSlug: string): Promise<{ id: string }> {
    const project = await this.prisma.forSystem().project.findFirst({
      where: { workspaceId, slug: projectSlug, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }
}
