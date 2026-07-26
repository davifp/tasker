import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Idempotent } from '../common/idempotency/idempotency.decorators';
import { Roles } from '../common/context/roles.decorator';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEpicDto } from './dto/create-epic.dto';
import { UpdateEpicDto } from './dto/update-epic.dto';
import { EpicsService } from './epics.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug')
export class EpicsController {
  constructor(
    private readonly epics: EpicsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('projects/:projectSlug/epics')
  @Idempotent()
  @Roles('ADMIN')
  async create(
    @Param('projectSlug') projectSlug: string,
    @Body() dto: CreateEpicDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.resolveProject(ctx.workspaceId, projectSlug);
    return this.epics.create({
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      title: dto.title,
      description: dto.description,
      status: dto.status,
      startQuarter: dto.startQuarter,
      endQuarter: dto.endQuarter,
      actorUserId: ctx.userId,
    });
  }

  @Patch('epics/:id')
  @Roles('ADMIN')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEpicDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.epics.update(
      ctx.workspaceId,
      id,
      {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        startQuarter: dto.startQuarter,
        endQuarter: dto.endQuarter,
      },
      ctx.userId,
    );
  }

  @Delete('epics/:id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ): Promise<void> {
    const ctx = requireCtx(req);
    await this.epics.softDelete(ctx.workspaceId, id, ctx.userId);
  }

  @Post('epics/:id/tasks/:taskId')
  @Idempotent()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async linkTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ): Promise<void> {
    const ctx = requireCtx(req);
    await this.epics.linkTask(ctx.workspaceId, id, taskId);
  }

  @Delete('epics/:id/tasks/:taskId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlinkTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ): Promise<void> {
    const ctx = requireCtx(req);
    await this.epics.unlinkTask(ctx.workspaceId, id, taskId);
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
