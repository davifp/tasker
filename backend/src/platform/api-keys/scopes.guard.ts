import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ApiKeyScope } from '@tasker/config';
import { REQUIRE_SCOPES_KEY } from './scopes.decorator';

export interface ApiKeyRequestPrincipal {
  kind: 'api-key';
  apiKeyId: string;
  workspaceId: string;
  scopes: ApiKeyScope[];
}

export interface JwtRequestPrincipal {
  kind?: 'jwt';
}

type Principal = ApiKeyRequestPrincipal | JwtRequestPrincipal;

/**
 * Enforces `@RequireScopes(...)` for API-key–authenticated requests. Requests
 * authenticated by JWT (web UI sessions) always pass — the scope model only
 * exists to constrain third-party automations.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(
      REQUIRE_SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: Principal }>();
    const principal = request.user;

    // No API-key principal → JWT (or no auth) → scopes don't apply.
    if (!principal || principal.kind !== 'api-key') {
      return true;
    }

    const granted = new Set(principal.scopes);
    const missing = required.filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/api-key-missing-scope',
        title: 'Insufficient API key scope',
        detail: `This endpoint requires: ${required.join(', ')}. Missing: ${missing.join(', ')}.`,
        status: 403,
        requiredScopes: required,
        missingScopes: missing,
      });
    }
    return true;
  }
}
