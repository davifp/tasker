import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuditEvent } from '../../common/audit/audit.events';
import { Auditable } from '../../common/audit/auditable.decorator';
import { Roles } from '../../common/context/roles.decorator';
import type { WorkspaceContext } from '../../common/context/workspace-context.store';
import { Idempotent } from '../../common/idempotency/idempotency.decorators';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { ListWebhookDeliveriesQueryDto } from './dto/list-deliveries-query.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhooksService } from './webhooks.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @Roles('ADMIN')
  async list(@Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext }) {
    const ctx = requireCtx(req);
    const items = await this.webhooks.list(ctx.workspaceId);
    return { items };
  }

  @Get(':id')
  @Roles('ADMIN')
  async findOne(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.webhooks.findOne(ctx.workspaceId, id);
  }

  @Post()
  @Idempotent()
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.WEBHOOK_CREATED,
    targetType: 'webhook',
    targetIdFrom: (_req, body) => (body as { webhook?: { id?: string } } | null)?.webhook?.id,
  })
  async create(
    @Body() dto: CreateWebhookDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.webhooks.create({
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      url: dto.url,
      eventTypes: dto.eventTypes,
      isActive: dto.isActive,
    });
  }

  @Patch(':id')
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.WEBHOOK_UPDATED,
    targetType: 'webhook',
    targetIdFrom: (req) => (req.params as { id?: string }).id,
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.webhooks.update({
      workspaceId: ctx.workspaceId,
      webhookId: id,
      url: dto.url,
      eventTypes: dto.eventTypes,
      isActive: dto.isActive,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.WEBHOOK_DELETED,
    targetType: 'webhook',
    targetIdFrom: (req) => (req.params as { id?: string }).id,
  })
  async remove(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    await this.webhooks.remove(ctx.workspaceId, id);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.WEBHOOK_SECRET_ROTATED,
    targetType: 'webhook',
    targetIdFrom: (req) => (req.params as { id?: string }).id,
  })
  async rotateSecret(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.webhooks.rotateSecret(ctx.workspaceId, id);
  }

  @Get(':id/deliveries')
  @Roles('ADMIN')
  async listDeliveries(
    @Param('id') id: string,
    @Query() query: ListWebhookDeliveriesQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.webhooks.listDeliveries(ctx.workspaceId, id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get(':id/dlq')
  @Roles('ADMIN')
  async listDeadLetter(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const items = await this.webhooks.listDeadLetter(ctx.workspaceId, id);
    return { items };
  }
}
