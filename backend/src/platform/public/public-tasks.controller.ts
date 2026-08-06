import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuditEvent } from '../../common/audit/audit.events';
import { Auditable } from '../../common/audit/auditable.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/csrf/skip-csrf.decorator';
import type { WorkspaceContext } from '../../common/context/workspace-context.store';
import { Idempotent } from '../../common/idempotency/idempotency.decorators';
import { ProjectsService } from '../../projects/projects.service';
import { CreateTaskDto } from '../../tasks/dto/create-task.dto';
import { ListTasksQueryDto } from '../../tasks/dto/list-tasks-query.dto';
import { UpdateTaskDto } from '../../tasks/dto/update-task.dto';
import { TasksService } from '../../tasks/tasks.service';
import { ApiKeyAuthGuard } from '../api-keys/api-key-auth.guard';
import { RequireScopes } from '../api-keys/scopes.decorator';
import { ScopesGuard } from '../api-keys/scopes.guard';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

function parseNumber(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== raw) {
    throw new BadRequestException('Task number must be a positive integer');
  }
  return n;
}

/**
 * Public tasks surface — mirrors the internal (JWT) tasks controller but with
 * scope-gated access. Nested under a project because the existing
 * `TasksService.listForProject` API is scoped that way; a workspace-wide
 * `GET /public/workspaces/:slug/tasks` is not exposed in v1 to keep the
 * public contract narrow and stable.
 */
@Public()
@SkipCsrf()
@UseGuards(ApiKeyAuthGuard, ScopesGuard)
@Controller('public/workspaces/:slug/projects/:projectSlug/tasks')
export class PublicTasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly projects: ProjectsService,
  ) {}

  @Get()
  @RequireScopes('tasks:read')
  async list(
    @Param('projectSlug') projectSlug: string,
    @Query() query: ListTasksQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    return this.tasks.listForProject(ctx.workspaceId, project.id, {
      cursor: query.cursor,
      limit: query.limit,
      status: query.status,
      assigneeUserId: query.assigneeUserId,
      labelId: query.labelId,
      labelIds: query.labels,
      includeDeleted: query.includeDeleted,
      sort: query.sort,
      sortDir: query.sortDir,
      from: query.from,
      to: query.to,
      priority: query.priority,
    });
  }

  @Get(':number')
  @RequireScopes('tasks:read')
  async findOne(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    const task = await this.tasks.findByNumber(
      ctx.workspaceId,
      project.id,
      parseNumber(numberParam),
    );
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  @Post()
  @Idempotent()
  @RequireScopes('tasks:write')
  @Auditable({
    event: AuditEvent.TASK_CREATED,
    targetType: 'task',
    targetIdFrom: (_req, body) => (body as { id?: string } | null)?.id,
  })
  async create(
    @Param('projectSlug') projectSlug: string,
    @Body() dto: CreateTaskDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    return this.tasks.create({
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      assigneeUserId: dto.assigneeUserId,
      startDate: dto.startDate,
      dueDate: dto.dueDate,
      labelIds: dto.labelIds,
      actorUserId: ctx.userId,
    });
  }

  @Patch(':number')
  @RequireScopes('tasks:write')
  @Auditable({
    event: AuditEvent.TASK_UPDATED,
    targetType: 'task',
    targetIdFrom: (_req, body) => (body as { id?: string } | null)?.id,
  })
  async update(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Body() dto: UpdateTaskDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    const existing = await this.tasks.findByNumber(
      ctx.workspaceId,
      project.id,
      parseNumber(numberParam),
    );
    if (!existing) throw new NotFoundException('Task not found');
    return this.tasks.update(ctx.workspaceId, existing.id, dto, ctx.userId);
  }

  @Delete(':number')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('tasks:write')
  @Auditable({
    event: AuditEvent.TASK_DELETED,
    targetType: 'task',
    targetIdFrom: (req) => {
      const v = req.params?.number;
      return typeof v === 'string' ? v : undefined;
    },
  })
  async remove(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    const existing = await this.tasks.findByNumber(
      ctx.workspaceId,
      project.id,
      parseNumber(numberParam),
    );
    if (!existing) throw new NotFoundException('Task not found');
    await this.tasks.softDelete({
      workspaceId: ctx.workspaceId,
      taskId: existing.id,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
    });
  }
}
