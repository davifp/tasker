import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Idempotent } from '../common/idempotency/idempotency.decorators';
import { Roles } from '../common/context/roles.decorator';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { Auditable } from '../common/audit/auditable.decorator';
import { AuditEvent } from '../common/audit/audit.events';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { SprintTasksMutationDto } from './dto/sprint-tasks-mutation.dto';
import { CapacityUpsertDto } from './dto/capacity-upsert.dto';
import { ListSprintsQueryDto } from './dto/list-sprints-query.dto';
import { SprintPlannerService } from './sprint-planner.service';
import { SprintsService } from './sprints.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug/projects/:projectSlug/sprints')
export class SprintsController {
  constructor(
    private readonly sprints: SprintsService,
    private readonly planner: SprintPlannerService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Idempotent()
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.SPRINT_CREATED,
    targetType: 'sprint',
    targetIdFrom: (_req, body) => (body as { id?: string } | null)?.id,
  })
  async create(
    @Param('projectSlug') projectSlug: string,
    @Body() dto: CreateSprintDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    return this.sprints.create({
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      name: dto.name,
      goal: dto.goal,
      startDate: dto.startDate,
      endDate: dto.endDate,
      actorUserId: ctx.userId,
    });
  }

  @Get()
  async list(
    @Param('projectSlug') projectSlug: string,
    @Query() query: ListSprintsQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    return this.sprints.list(ctx.workspaceId, project.id, {
      cursor: query.cursor,
      limit: query.limit,
      state: query.state,
    });
  }

  @Get(':sprintNumber')
  async findOne(
    @Param('projectSlug') projectSlug: string,
    @Param('sprintNumber', ParseIntPipe) sprintNumber: number,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    const sprint = await this.sprints.findByNumber(ctx.workspaceId, project.id, sprintNumber);
    if (!sprint) throw new NotFoundException('Sprint not found');
    return sprint;
  }

  @Patch(':sprintNumber')
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.SPRINT_UPDATED,
    targetType: 'sprint',
    targetIdFrom: (_req, body) => (body as { id?: string } | null)?.id,
  })
  async update(
    @Param('projectSlug') projectSlug: string,
    @Param('sprintNumber', ParseIntPipe) sprintNumber: number,
    @Body() dto: UpdateSprintDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    const sprint = await this.sprints.findByNumber(ctx.workspaceId, project.id, sprintNumber);
    if (!sprint) throw new NotFoundException('Sprint not found');
    return this.sprints.update(ctx.workspaceId, sprint.id, {
      name: dto.name,
      goal: dto.goal,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });
  }

  @Post(':sprintNumber/tasks')
  @Idempotent()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async mutateTasks(
    @Param('projectSlug') projectSlug: string,
    @Param('sprintNumber', ParseIntPipe) sprintNumber: number,
    @Body() dto: SprintTasksMutationDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ): Promise<void> {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    const sprint = await this.sprints.findByNumber(ctx.workspaceId, project.id, sprintNumber);
    if (!sprint) throw new NotFoundException('Sprint not found');
    await this.planner.addRemoveTasks({
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      sprintId: sprint.id,
      add: dto.add,
      remove: dto.remove,
      actorUserId: ctx.userId,
    });
  }

  @Post(':sprintNumber/start')
  @Idempotent()
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.SPRINT_STARTED,
    targetType: 'sprint',
    targetIdFrom: (_req, body) => (body as { id?: string } | null)?.id,
  })
  async start(
    @Param('projectSlug') projectSlug: string,
    @Param('sprintNumber', ParseIntPipe) sprintNumber: number,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    const sprint = await this.sprints.findByNumber(ctx.workspaceId, project.id, sprintNumber);
    if (!sprint) throw new NotFoundException('Sprint not found');
    return this.sprints.start(ctx.workspaceId, sprint.id, ctx.userId);
  }

  @Post(':sprintNumber/complete')
  @Idempotent()
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.SPRINT_COMPLETED,
    targetType: 'sprint',
    targetIdFrom: (_req, body) => (body as { id?: string } | null)?.id,
  })
  async complete(
    @Param('projectSlug') projectSlug: string,
    @Param('sprintNumber', ParseIntPipe) sprintNumber: number,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    const sprint = await this.sprints.findByNumber(ctx.workspaceId, project.id, sprintNumber);
    if (!sprint) throw new NotFoundException('Sprint not found');
    return this.sprints.complete(ctx.workspaceId, sprint.id, ctx.userId);
  }

  @Post(':sprintNumber/capacity')
  @Idempotent()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async upsertCapacity(
    @Param('projectSlug') projectSlug: string,
    @Param('sprintNumber', ParseIntPipe) sprintNumber: number,
    @Body() dto: CapacityUpsertDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ): Promise<void> {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    const sprint = await this.sprints.findByNumber(ctx.workspaceId, project.id, sprintNumber);
    if (!sprint) throw new NotFoundException('Sprint not found');
    await this.planner.upsertCapacity({
      workspaceId: ctx.workspaceId,
      sprintId: sprint.id,
      entries: dto.entries,
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async resolveProject(workspaceId: string, projectSlug: string): Promise<{ id: string }> {
    const project = await this.prisma.forSystem().project.findFirst({
      where: { workspaceId, slug: projectSlug, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }
}
