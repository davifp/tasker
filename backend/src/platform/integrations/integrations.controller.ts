import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AuditEvent } from '../../common/audit/audit.events';
import { Auditable } from '../../common/audit/auditable.decorator';
import { Roles } from '../../common/context/roles.decorator';
import type { WorkspaceContext } from '../../common/context/workspace-context.store';
import { PrismaService } from '../../prisma/prisma.service';
import { INTEGRATION_PROVIDERS, type IntegrationProviderName } from '@tasker/config';
import { IntegrationsService } from './integrations.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

function assertProvider(value: string): IntegrationProviderName {
  if (!(INTEGRATION_PROVIDERS as readonly string[]).includes(value)) {
    throw new NotFoundException(`Unknown integration provider: ${value}`);
  }
  return value as IntegrationProviderName;
}

@Controller('workspaces/:slug/integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Roles('ADMIN')
  async list(@Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext }) {
    const ctx = requireCtx(req);
    const items = await this.integrations.list(ctx.workspaceId);
    return { items };
  }

  @Delete(':provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.INTEGRATION_DISCONNECTED,
    targetType: 'integration',
    targetIdFrom: (req) => (req.params as { provider?: string }).provider,
  })
  async disconnect(
    @Param('provider') providerParam: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const provider = assertProvider(providerParam);
    // Hard-delete the row so no residual token remains. Downstream sync jobs
    // read `Integration` on every enqueue, so a deleted row halts sync within
    // one job cycle.
    await this.prisma.forSystem().integration.deleteMany({
      where: { workspaceId: ctx.workspaceId, provider },
    });
  }
}
