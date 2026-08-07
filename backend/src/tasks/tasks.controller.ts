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
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Idempotent } from '../common/idempotency/idempotency.decorators';
import { Roles } from '../common/context/roles.decorator';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { Auditable } from '../common/audit/auditable.decorator';
import { AuditEvent } from '../common/audit/audit.events';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { TasksService } from './tasks.service';
import { ProjectsService } from '../projects/projects.service';

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

@Controller('workspaces/:slug/projects/:projectSlug/tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly projects: ProjectsService,
  ) {}

  @Post()
  @Roles('MEMBER')
  @Idempotent()
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

  @Get()
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
      ...(query.sprintId !== undefined
        ? { sprintId: query.sprintId === 'none' ? null : query.sprintId }
        : {}),
    });
  }

  @Get(':number')
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

  @Patch(':number')
  @Roles('MEMBER')
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
    const task = await this.tasks.findByNumber(
      ctx.workspaceId,
      project.id,
      parseNumber(numberParam),
    );
    if (!task) throw new NotFoundException('Task not found');
    return this.tasks.update(ctx.workspaceId, task.id, dto, ctx.userId);
  }

  @Post(':number/move')
  @Roles('MEMBER')
  async move(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Body() dto: MoveTaskDto,
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
    const result = await this.tasks.move({
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      taskId: task.id,
      status: dto.status,
      position: dto.position,
      ifUnchangedSince: new Date(dto.ifUnchangedSince),
      actorUserId: ctx.userId,
      overrideBlockers: dto.overrideBlockers,
    });
    if (result.kind === 'blocked') {
      return {
        ...result.task,
        acknowledgedBlockersOpen: result.acknowledgedBlockersOpen,
      };
    }
    return result.task;
  }

  @Delete(':number')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    event: AuditEvent.TASK_DELETED,
    targetType: 'task',
    // 204 body is empty; capture the number from the URL param instead.
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
    const task = await this.tasks.findByNumber(
      ctx.workspaceId,
      project.id,
      parseNumber(numberParam),
    );
    if (!task) throw new NotFoundException('Task not found');
    await this.tasks.softDelete({
      workspaceId: ctx.workspaceId,
      taskId: task.id,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
    });
  }

  @Post(':number/restore')
  @Roles('MEMBER')
  async restore(
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
      true,
    );
    if (!task) throw new NotFoundException('Task not found');
    return this.tasks.restore({
      workspaceId: ctx.workspaceId,
      taskId: task.id,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
    });
  }
}
