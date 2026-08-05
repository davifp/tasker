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
  Post,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuditEvent } from '../../../common/audit/audit.events';
import { Auditable } from '../../../common/audit/auditable.decorator';
import { Roles } from '../../../common/context/roles.decorator';
import type { WorkspaceContext } from '../../../common/context/workspace-context.store';
import { Idempotent } from '../../../common/idempotency/idempotency.decorators';
import { ProjectsService } from '../../../projects/projects.service';
import { TasksService } from '../../../tasks/tasks.service';
import { CreateTaskLinkDto } from './dto/create-task-link.dto';
import { GithubLinkService } from './github-link.service';

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
    throw new NotFoundException('Task not found');
  }
  return n;
}

@Controller('workspaces/:slug/projects/:projectSlug/tasks/:number/github-links')
export class GithubLinkController {
  constructor(
    private readonly links: GithubLinkService,
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
  ) {}

  @Get()
  @Roles('MEMBER')
  async list(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    const items = await this.links.list(ctx.workspaceId, task.id);
    return { items };
  }

  @Post()
  @Idempotent()
  @Roles('MEMBER')
  @Auditable({
    event: AuditEvent.INTEGRATION_TASK_LINKED,
    targetType: 'task_external_link',
    targetIdFrom: (_req, body) => (body as { id?: string } | null)?.id,
  })
  async create(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Body() dto: CreateTaskLinkDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.links.create({
      workspaceId: ctx.workspaceId,
      taskId: task.id,
      externalRef: dto.externalRef,
      externalType: dto.externalType,
    });
  }

  @Delete(':linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('MEMBER')
  @Auditable({
    event: AuditEvent.INTEGRATION_TASK_UNLINKED,
    targetType: 'task_external_link',
    targetIdFrom: (req) => (req.params as { linkId?: string }).linkId,
  })
  async remove(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('linkId') linkId: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    await this.links.remove(ctx.workspaceId, task.id, linkId);
  }

  private async resolveTask(
    workspaceId: string,
    projectSlug: string,
    numberParam: string,
  ): Promise<{ id: string }> {
    const project = await this.projects.findBySlug(workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    const task = await this.tasks.findByNumber(workspaceId, project.id, parseNumber(numberParam));
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
