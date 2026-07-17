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
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { TaskCommentsService } from './task-comments.service';

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

@Controller('workspaces/:slug/projects/:projectSlug/tasks/:number/comments')
export class TaskCommentsController {
  constructor(
    private readonly comments: TaskCommentsService,
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
    return this.comments.list(ctx.workspaceId, task.id);
  }

  @Post()
  @Roles('MEMBER')
  async create(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Body() dto: CreateCommentDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.comments.create({
      workspaceId: ctx.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      body: dto.body,
      actorUserId: ctx.userId,
    });
  }

  @Patch(':id')
  @Roles('MEMBER')
  async update(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.comments.update({
      workspaceId: ctx.workspaceId,
      commentId: id,
      body: dto.body,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
    });
  }

  @Delete(':id')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    await this.comments.remove({
      workspaceId: ctx.workspaceId,
      commentId: id,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
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
