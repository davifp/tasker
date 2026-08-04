import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ListApiKeysQueryDto } from './dto/list-api-keys-query.dto';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @Roles('ADMIN')
  async list(
    @Query() query: ListApiKeysQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const items = await this.apiKeys.list(ctx.workspaceId, {
      includeRevoked: query.includeRevoked ?? false,
    });
    return { items };
  }

  @Post()
  @Idempotent()
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.API_KEY_ISSUED,
    targetType: 'api_key',
    targetIdFrom: (_req, body) => (body as { key?: { id?: string } } | null)?.key?.id,
  })
  async create(
    @Body() dto: CreateApiKeyDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.apiKeys.create({
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
      name: dto.name,
      scopes: dto.scopes,
      expiresAt: dto.expiresAt,
    });
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.API_KEY_REVOKED,
    targetType: 'api_key',
    targetIdFrom: (req) => (req.params as { id?: string }).id,
  })
  async revoke(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const key = await this.apiKeys.revoke(ctx.workspaceId, id);
    return { key };
  }
}
