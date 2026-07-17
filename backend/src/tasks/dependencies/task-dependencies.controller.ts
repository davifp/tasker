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
  Post,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Roles } from '../../common/context/roles.decorator';
import { WorkspaceContext } from '../../common/context/workspace-context.store';
import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../tasks.service';
import { CreateDependencyDto } from './dto/create-dependency.dto';
import { TaskDependenciesService } from './task-dependencies.service';

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

@Controller('workspaces/:slug/projects/:projectSlug/tasks/:number/dependencies')
export class TaskDependenciesController {
  constructor(
    private readonly deps: TaskDependenciesService,
    private readonly tasks: TasksService,
    private readonly projects: ProjectsService,
  ) {}

  @Get()
  async list(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.deps.listForTask(ctx.workspaceId, task.id);
  }

  @Post()
  @Roles('MEMBER')
  async add(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Body() dto: CreateDependencyDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.deps.add({
      workspaceId: ctx.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      blockedByTaskId: dto.blockedByTaskId,
      actorUserId: ctx.userId,
    });
  }

  @Delete(':blockerId')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('blockerId') blockerId: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    await this.deps.remove({
      workspaceId: ctx.workspaceId,
      taskId: task.id,
      blockedByTaskId: blockerId,
    });
  }

  private async resolveTask(workspaceId: string, projectSlug: string, numberParam: string) {
    const project = await this.projects.findBySlug(workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    const task = await this.tasks.findByNumber(workspaceId, project.id, parseNumber(numberParam));
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
