import { SetMetadata } from '@nestjs/common';
import type { ApiKeyScope } from '@tasker/config';

export const REQUIRE_SCOPES_KEY = 'platform.requireScopes' as const;

/**
 * Declare the minimum set of API-key scopes a route needs. JWT-authenticated
 * requests (web UI) bypass this check — the scope model only applies to
 * requests authenticated by an API key.
 *
 * Usage: `@RequireScopes('tasks:read')` — all listed scopes must be present.
 */
export const RequireScopes = (
  ...scopes: [ApiKeyScope, ...ApiKeyScope[]]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRE_SCOPES_KEY, scopes);
