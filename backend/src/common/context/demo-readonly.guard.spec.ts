import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { DemoReadOnlyGuard } from './demo-readonly.guard';

function httpContext(method: string, workspaceContext?: { role: string }): ExecutionContext {
  const req = { method, workspaceContext };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('DemoReadOnlyGuard', () => {
  const guard = new DemoReadOnlyGuard();

  it('lets read verbs through even for DEMO_VIEWER', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const ctx = httpContext(method, { role: 'DEMO_VIEWER' });
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('lets mutating verbs through for non-DEMO_VIEWER roles', () => {
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'GUEST']) {
      const ctx = httpContext('POST', { role });
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('rejects mutating verbs for DEMO_VIEWER', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const ctx = httpContext(method, { role: 'DEMO_VIEWER' });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    }
  });

  it('lets requests without workspace context through', () => {
    const ctx = httpContext('POST');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('bypasses non-http contexts (WS)', () => {
    const ctx = { getType: () => 'ws' } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
