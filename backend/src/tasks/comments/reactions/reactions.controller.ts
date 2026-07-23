import {
  BadRequestException,
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
import { Roles } from '../../../common/context/roles.decorator';
import { WorkspaceContext } from '../../../common/context/workspace-context.store';
import { ProjectsService } from '../../../projects/projects.service';
import { TasksService } from '../../tasks.service';
import { ReactionsService } from './reactions.service';

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

@Controller('workspaces/:slug/projects/:projectSlug/tasks/:number/comments/:commentId/reactions')
export class ReactionsController {
  constructor(
    private readonly reactions: ReactionsService,
    private readonly tasks: TasksService,
    private readonly projects: ProjectsService,
  ) {}

  @Get()
  async list(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('commentId') commentId: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.reactions.list(commentId, {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
  }

  @Post(':emoji')
  @Roles('MEMBER')
  async add(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('commentId') commentId: string,
    @Param('emoji') emoji: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.reactions.add(commentId, emoji, {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    });
  }

  @Delete(':emoji')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('commentId') commentId: string,
    @Param('emoji') emoji: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    await this.reactions.remove(commentId, emoji, {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
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
