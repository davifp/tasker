import {
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
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';
import { ProjectsService } from './projects.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @Roles('ADMIN')
  @Idempotent()
  @Auditable({
    event: AuditEvent.PROJECT_CREATED,
    targetType: 'project',
    targetIdFrom: (_req, body) => (body as { id?: string } | null)?.id,
  })
  async create(
    @Body() dto: CreateProjectDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.projects.create({
      name: dto.name,
      slug: dto.slug,
      color: dto.color,
      icon: dto.icon,
      description: dto.description,
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
    });
  }

  @Get()
  async list(
    @Query() query: ListProjectsQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.projects.list(ctx.workspaceId, {
      cursor: query.cursor,
      limit: query.limit,
      status: query.status,
      includeDeleted: query.includeDeleted,
    });
  }

  @Get(':projectSlug')
  async findOne(
    @Param('projectSlug') projectSlug: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  @Patch(':projectSlug')
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.PROJECT_UPDATED,
    targetType: 'project',
    targetIdFrom: (_req, body) => (body as { id?: string } | null)?.id,
  })
  async update(
    @Param('projectSlug') projectSlug: string,
    @Body() dto: UpdateProjectDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    return this.projects.update(ctx.workspaceId, project.id, dto, ctx.userId);
  }

  @Delete(':projectSlug')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    event: AuditEvent.PROJECT_DELETED,
    targetType: 'project',
    targetIdFrom: (req) => {
      const v = req.params?.projectSlug;
      return typeof v === 'string' ? v : undefined;
    },
  })
  async remove(
    @Param('projectSlug') projectSlug: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    await this.projects.softDelete({
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      actorUserId: ctx.userId,
    });
  }

  @Post(':projectSlug/restore')
  @Roles('ADMIN')
  async restore(
    @Param('projectSlug') projectSlug: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug, true);
    if (!project) throw new NotFoundException('Project not found');
    return this.projects.restore({
      workspaceId: ctx.workspaceId,
      projectId: project.id,
      actorUserId: ctx.userId,
    });
  }
}
