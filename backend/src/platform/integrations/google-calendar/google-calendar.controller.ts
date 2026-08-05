import { Body, Controller, ForbiddenException, Post, Request } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuditEvent } from '../../../common/audit/audit.events';
import { Auditable } from '../../../common/audit/auditable.decorator';
import { Roles } from '../../../common/context/roles.decorator';
import type { WorkspaceContext } from '../../../common/context/workspace-context.store';
import { Idempotent } from '../../../common/idempotency/idempotency.decorators';
import { CompleteIntegrationConnectionDto } from '../dto/complete-connection.dto';
import { StartIntegrationConnectionDto } from '../dto/start-connection.dto';
import { IntegrationOAuthStateService } from '../integration-oauth-state.service';
import { GoogleCalendarService } from './google-calendar.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug/integrations/google-calendar')
export class GoogleCalendarController {
  constructor(
    private readonly google: GoogleCalendarService,
    private readonly state: IntegrationOAuthStateService,
    private readonly config: ConfigService,
  ) {}

  @Post('start')
  @Roles('ADMIN')
  async start(
    @Body() dto: StartIntegrationConnectionDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const state = await this.state.issue(
      'GOOGLE_CALENDAR',
      ctx.workspaceId,
      ctx.userId,
      dto.returnTo,
    );
    const authorizeUrl = this.google.buildAuthorizeUrl(state, this.redirectUri());
    return { authorizeUrl, scopes: this.google.scopesForConsentCopy() };
  }

  @Post('complete')
  @Idempotent()
  @Roles('ADMIN')
  @Auditable({
    event: AuditEvent.INTEGRATION_CONNECTED,
    targetType: 'integration',
    targetIdFrom: (_req, body) =>
      (body as { integrationId?: string } | null)?.integrationId ?? 'GOOGLE_CALENDAR',
  })
  async complete(
    @Body() dto: CompleteIntegrationConnectionDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const stored = await this.state.consume(dto.state, 'GOOGLE_CALENDAR');
    if (stored.workspaceId !== ctx.workspaceId || stored.userId !== ctx.userId) {
      throw new ForbiddenException('Integration state does not match the current session');
    }
    return this.google.completeConnection({
      code: dto.code,
      redirectUri: this.redirectUri(),
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.userId,
    });
  }

  private redirectUri(): string {
    const base = this.config.get<string>('OAUTH_CALLBACK_BASE_URL', 'http://localhost:3001');
    return `${base}/api/v1/integrations/google-calendar/callback`;
  }
}
