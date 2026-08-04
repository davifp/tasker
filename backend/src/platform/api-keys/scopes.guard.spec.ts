import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ScopesGuard, type ApiKeyRequestPrincipal } from './scopes.guard';

function ctxWith(
  principal: ApiKeyRequestPrincipal | { kind?: 'jwt' } | undefined,
): ExecutionContext {
  return {
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user: principal }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function guardWith(required: string[] | undefined): ScopesGuard {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new ScopesGuard(reflector);
}

describe('ScopesGuard', () => {
  it('passes when no scopes are required', () => {
    const guard = guardWith(undefined);
    expect(guard.canActivate(ctxWith(undefined))).toBe(true);
  });

  it('passes JWT requests through without checking scopes', () => {
    const guard = guardWith(['tasks:read']);
    expect(guard.canActivate(ctxWith({ kind: 'jwt' }))).toBe(true);
  });

  it('allows requests when the api-key principal has the required scope', () => {
    const guard = guardWith(['tasks:read']);
    const principal: ApiKeyRequestPrincipal = {
      kind: 'api-key',
      apiKeyId: 'k1',
      workspaceId: 'w1',
      scopes: ['tasks:read', 'projects:read'],
    };
    expect(guard.canActivate(ctxWith(principal))).toBe(true);
  });

  it('rejects api-key requests missing a required scope with Problem Details', () => {
    const guard = guardWith(['tasks:write']);
    const principal: ApiKeyRequestPrincipal = {
      kind: 'api-key',
      apiKeyId: 'k1',
      workspaceId: 'w1',
      scopes: ['tasks:read'],
    };
    try {
      guard.canActivate(ctxWith(principal));
      throw new Error('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const problem = (err as ForbiddenException).getResponse() as {
        type: string;
        missingScopes: string[];
      };
      expect(problem.type).toContain('api-key-missing-scope');
      expect(problem.missingScopes).toEqual(['tasks:write']);
    }
  });

  it('rejects when only a subset of the required scopes are granted', () => {
    const guard = guardWith(['tasks:read', 'tasks:write']);
    const principal: ApiKeyRequestPrincipal = {
      kind: 'api-key',
      apiKeyId: 'k1',
      workspaceId: 'w1',
      scopes: ['tasks:read'],
    };
    expect(() => guard.canActivate(ctxWith(principal))).toThrow(ForbiddenException);
  });
});
