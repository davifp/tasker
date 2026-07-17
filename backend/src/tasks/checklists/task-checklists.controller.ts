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
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Roles } from '../../common/context/roles.decorator';
import { WorkspaceContext } from '../../common/context/workspace-context.store';
import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../tasks.service';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { TaskChecklistsService } from './task-checklists.service';

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

@Controller('workspaces/:slug/projects/:projectSlug/tasks/:number/checklist')
export class TaskChecklistsController {
  constructor(
    private readonly checklists: TaskChecklistsService,
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
    return this.checklists.list(ctx.workspaceId, task.id);
  }

  @Post()
  @Roles('MEMBER')
  async create(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Body() dto: CreateChecklistItemDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.checklists.create({
      workspaceId: ctx.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      title: dto.title,
      actorUserId: ctx.userId,
    });
  }

  @Patch(':itemId')
  @Roles('MEMBER')
  async update(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.checklists.update({
      workspaceId: ctx.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      itemId,
      patch: { title: dto.title, checked: dto.checked, position: dto.position },
      actorUserId: ctx.userId,
    });
  }

  @Delete(':itemId')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('itemId') itemId: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    await this.checklists.remove(ctx.workspaceId, task.id, itemId);
  }

  private async resolveTask(workspaceId: string, projectSlug: string, numberParam: string) {
    const project = await this.projects.findBySlug(workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    const task = await this.tasks.findByNumber(workspaceId, project.id, parseNumber(numberParam));
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
