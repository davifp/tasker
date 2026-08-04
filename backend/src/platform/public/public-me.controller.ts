import { Controller, ForbiddenException, Get, Request, UseGuards } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import type { WorkspaceContext } from '../../common/context/workspace-context.store';
import { ApiKeyAuthGuard } from '../api-keys/api-key-auth.guard';
import type { ApiKeyRequestPrincipal } from '../api-keys/scopes.guard';

/**
 * Returns the acting API-key principal. Useful for automations to verify what
 * they can and can't do (scopes) without probing every endpoint. This route
 * carries no `@RequireScopes(...)` because any authenticated key should be
 * able to introspect its own capabilities.
 */
@Public()
@UseGuards(ApiKeyAuthGuard)
@Controller('public/workspaces/:slug/me')
export class PublicMeController {
  @Get()
  me(
    @Request()
    req: ExpressRequest & {
      user?: ApiKeyRequestPrincipal;
      workspaceContext?: WorkspaceContext;
    },
  ) {
    const principal = req.user;
    const context = req.workspaceContext;
    if (!principal || principal.kind !== 'api-key' || !context) {
      throw new ForbiddenException('API-key context not resolved');
    }
    return {
      apiKeyId: principal.apiKeyId,
      workspaceId: context.workspaceId,
      role: context.role,
      scopes: principal.scopes,
      actor: {
        userId: context.userId,
        membershipId: context.membershipId,
      },
    };
  }
}
