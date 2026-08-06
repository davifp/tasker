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
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuditEvent } from '../../common/audit/audit.events';
import { Auditable } from '../../common/audit/auditable.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/csrf/skip-csrf.decorator';
import type { WorkspaceContext } from '../../common/context/workspace-context.store';
import { Idempotent } from '../../common/idempotency/idempotency.decorators';
import { CreateProjectDto } from '../../projects/dto/create-project.dto';
import { ListProjectsQueryDto } from '../../projects/dto/list-projects-query.dto';
import { UpdateProjectDto } from '../../projects/dto/update-project.dto';
import { ProjectsService } from '../../projects/projects.service';
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

/**
 * Public projects surface. Delegates all business logic to the existing
 * `ProjectsService`; this controller is only responsible for gating access
 * behind API-key scopes and mounting the endpoints under `/api/v1/public/`.
 */
@Public()
@SkipCsrf()
@UseGuards(ApiKeyAuthGuard, ScopesGuard)
@Controller('public/workspaces/:slug/projects')
export class PublicProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequireScopes('projects:read')
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
  @RequireScopes('projects:read')
  async findOne(
    @Param('projectSlug') projectSlug: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    // 404 (not 403) — never leak the presence of a slug the caller can't see.
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  @Post()
  @Idempotent()
  @RequireScopes('projects:write')
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

  @Patch(':projectSlug')
  @RequireScopes('projects:write')
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('projects:write')
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
}
