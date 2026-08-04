import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import type { Request } from 'express';
import type { WorkspaceContext } from '../../common/context/workspace-context.store';
import { ApiKeysService, VerifiedApiKey } from './api-keys.service';
import type { ApiKeyRequestPrincipal } from './scopes.guard';

export const API_KEY_STRATEGY = 'api-key' as const;

/**
 * Extracts an API-key from the standard `Authorization: Bearer <token>` header
 * and hands verification off to `ApiKeysService`. `passport-custom` gives us
 * a strategy that only fires when routes explicitly opt into
 * `AuthGuard('api-key')` — the global JWT guard covers everything else.
 *
 * Also mirrors what `WorkspaceGuard` does for JWT callers: fills
 * `req.workspaceContext` from the key's creator, so downstream services /
 * ALS scopes / audit interceptors see the same shape regardless of auth
 * method. `WorkspaceContextInterceptor` then opens the ALS scope.
 */
@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, API_KEY_STRATEGY) {
  constructor(private readonly apiKeys: ApiKeysService) {
    super();
  }

  async validate(req: Request): Promise<ApiKeyRequestPrincipal & { userId: string }> {
    const header = req.headers['authorization'];
    if (typeof header !== 'string') {
      throw new UnauthorizedException(this.buildProblem('Missing Authorization header'));
    }
    const [scheme, token] = header.split(' ', 2);
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException(this.buildProblem('Expected Bearer scheme'));
    }
    const verified: VerifiedApiKey | null = await this.apiKeys.verifyRawKey(token);
    if (!verified) {
      throw new UnauthorizedException(this.buildProblem('Invalid or revoked API key'));
    }

    const context: WorkspaceContext = {
      userId: verified.actorUserId,
      workspaceId: verified.workspaceId,
      role: verified.actorRole,
      membershipId: verified.actorMembershipId,
    };
    (req as unknown as { workspaceContext: WorkspaceContext }).workspaceContext = context;

    return {
      kind: 'api-key',
      apiKeyId: verified.apiKeyId,
      workspaceId: verified.workspaceId,
      scopes: verified.scopes,
      userId: verified.actorUserId,
    };
  }

  private buildProblem(detail: string) {
    return {
      type: 'https://tasker.dev/problems/api-key-unauthorized',
      title: 'Unauthorized',
      detail,
      status: 401,
    };
  }
}
