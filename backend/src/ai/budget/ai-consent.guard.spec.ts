import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AiConsentGuard } from './ai-consent.guard';
import { AI_CONSENT_SKIP_KEY } from './ai-consent.decorator';

function makeCtx(overrides: { workspaceId?: string; skip?: boolean }): {
  ctx: ExecutionContext;
  reflector: Reflector;
} {
  const reflector = {
    getAllAndOverride: vi.fn().mockImplementation((key: string) => {
      if (key === AI_CONSENT_SKIP_KEY) return overrides.skip ?? false;
      return undefined;
    }),
  } as unknown as Reflector;

  const req = overrides.workspaceId
    ? { workspaceContext: { workspaceId: overrides.workspaceId } }
    : {};
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

describe('AiConsentGuard', () => {
  it('allows routes marked @SkipAiConsent', async () => {
    const consent = { isCurrentlyAccepted: vi.fn() };
    const { ctx, reflector } = makeCtx({ skip: true });
    const guard = new AiConsentGuard(reflector, consent as never);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(consent.isCurrentlyAccepted).not.toHaveBeenCalled();
  });

  it('rejects with workspace-context-missing when no workspace context is present', async () => {
    const consent = { isCurrentlyAccepted: vi.fn() };
    const { ctx, reflector } = makeCtx({});
    const guard = new AiConsentGuard(reflector, consent as never);
    const err = await guard.canActivate(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().type).toBe('https://tasker.dev/problems/workspace-context-missing');
  });

  it('rejects with ai-consent-required when consent is not accepted', async () => {
    const consent = { isCurrentlyAccepted: vi.fn().mockResolvedValue(false) };
    const { ctx, reflector } = makeCtx({ workspaceId: 'ws-1' });
    const guard = new AiConsentGuard(reflector, consent as never);
    const err = await guard.canActivate(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().type).toBe('about:blank#ai-consent-required');
  });

  it('allows when consent is accepted for the current document version', async () => {
    const consent = { isCurrentlyAccepted: vi.fn().mockResolvedValue(true) };
    const { ctx, reflector } = makeCtx({ workspaceId: 'ws-1' });
    const guard = new AiConsentGuard(reflector, consent as never);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(consent.isCurrentlyAccepted).toHaveBeenCalledWith('ws-1');
  });
});
