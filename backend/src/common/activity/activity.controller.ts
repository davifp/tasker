import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Request,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import type { Request as ExpressRequest } from 'express';
import { listActivityQuerySchema } from '@tasker/config';
import { WorkspaceContext } from '../context/workspace-context.store';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from './activity.service';

class ListActivityQueryDto extends createZodDto(listActivityQuerySchema) {}

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug')
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('projects/:projectSlug/activity')
  async listForProject(
    @Param('projectSlug') projectSlug: string,
    @Query() query: ListActivityQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.prisma.forSystem().project.findFirst({
      where: { workspaceId: ctx.workspaceId, slug: projectSlug, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return this.activity.listForProject(ctx.workspaceId, project.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('projects/:projectSlug/tasks/:number/activity')
  async listForTask(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Query() query: ListActivityQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.prisma.forSystem().project.findFirst({
      where: { workspaceId: ctx.workspaceId, slug: projectSlug, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    const parsed = Number.parseInt(numberParam, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== numberParam) {
      throw new NotFoundException('Task not found');
    }
    const task = await this.prisma.forSystem().task.findFirst({
      where: { workspaceId: ctx.workspaceId, projectId: project.id, number: parsed },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return this.activity.listForTask(ctx.workspaceId, task.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
