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
  Query,
  Request,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import type { Request as ExpressRequest } from 'express';
import { listAttachmentsQuerySchema, signAttachmentSchema } from '@tasker/config';
import { Roles } from '../../common/context/roles.decorator';
import { WorkspaceContext } from '../../common/context/workspace-context.store';
import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../tasks.service';
import { AttachmentsService } from './attachments.service';

class SignAttachmentDto extends createZodDto(signAttachmentSchema) {}
class ListAttachmentsQueryDto extends createZodDto(listAttachmentsQuerySchema) {}

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

@Controller('workspaces/:slug/projects/:projectSlug/tasks/:number/attachments')
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly tasks: TasksService,
    private readonly projects: ProjectsService,
  ) {}

  @Post('sign')
  @Roles('MEMBER')
  async sign(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Body() dto: SignAttachmentDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.attachments.signUpload({
      workspaceId: ctx.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      actorUserId: ctx.userId,
      filename: dto.filename,
      mime: dto.mime,
      sizeBytes: dto.sizeBytes,
    });
  }

  @Post(':id/confirm')
  @Roles('MEMBER')
  async confirm(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.attachments.confirm(ctx.workspaceId, id, { userId: ctx.userId });
  }

  @Get()
  async list(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Query() query: ListAttachmentsQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const task = await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.attachments.list(ctx.workspaceId, task.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get(':id/download')
  async download(
    @Param('projectSlug') projectSlug: string,
    @Param('number') numberParam: string,
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.resolveTask(ctx.workspaceId, projectSlug, numberParam);
    return this.attachments.signDownload(ctx.workspaceId, id);
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
    await this.attachments.remove(ctx.workspaceId, id, {
      userId: ctx.userId,
      role: ctx.role,
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
