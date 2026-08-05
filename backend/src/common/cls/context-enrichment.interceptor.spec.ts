import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { ContextEnrichmentInterceptor } from './context-enrichment.interceptor';
import { CLS_USER_ID, CLS_WORKSPACE_ID } from './cls-keys';

function makeHost(
  request: Record<string, unknown>,
  type: 'http' | 'rpc' | 'ws' = 'http',
): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeCls(overrides: Partial<ClsService> = {}): {
  cls: ClsService;
  set: ReturnType<typeof vi.fn>;
} {
  const set = vi.fn();
  const cls = {
    isActive: () => true,
    set,
    ...overrides,
  } as unknown as ClsService;
  return { cls, set };
}

function next(): CallHandler {
  return { handle: () => of('ok') };
}

describe('ContextEnrichmentInterceptor', () => {
  it('sets userId + workspaceId from req.workspaceContext when both are present', () => {
    const { cls, set } = makeCls();
    const interceptor = new ContextEnrichmentInterceptor(cls);
    const req = { workspaceContext: { userId: 'u-1', workspaceId: 'w-1' } };
    interceptor.intercept(makeHost(req), next());
    expect(set).toHaveBeenCalledWith(CLS_USER_ID, 'u-1');
    expect(set).toHaveBeenCalledWith(CLS_WORKSPACE_ID, 'w-1');
  });

  it('falls back to req.user.userId when workspaceContext is missing', () => {
    const { cls, set } = makeCls();
    const interceptor = new ContextEnrichmentInterceptor(cls);
    const req = { user: { userId: 'u-2' } };
    interceptor.intercept(makeHost(req), next());
    expect(set).toHaveBeenCalledWith(CLS_USER_ID, 'u-2');
    expect(set).not.toHaveBeenCalledWith(CLS_WORKSPACE_ID, expect.anything());
  });

  it('sets nothing when neither req.user nor req.workspaceContext are present', () => {
    const { cls, set } = makeCls();
    const interceptor = new ContextEnrichmentInterceptor(cls);
    interceptor.intercept(makeHost({}), next());
    expect(set).not.toHaveBeenCalled();
  });

  it('skips non-HTTP contexts (rpc, ws) so gateway/queue calls do not pull HTTP shape', () => {
    const { cls, set } = makeCls();
    const interceptor = new ContextEnrichmentInterceptor(cls);
    interceptor.intercept(makeHost({}, 'ws'), next());
    expect(set).not.toHaveBeenCalled();
  });

  it('skips when the CLS scope is not active (defensive — guarded by the CLS module in prod)', () => {
    const { cls, set } = makeCls({ isActive: () => false } as Partial<ClsService>);
    const interceptor = new ContextEnrichmentInterceptor(cls);
    interceptor.intercept(makeHost({ user: { userId: 'u-x' } }), next());
    expect(set).not.toHaveBeenCalled();
  });

  it('passes the request through to the next handler unchanged', async () => {
    const { cls } = makeCls();
    const interceptor = new ContextEnrichmentInterceptor(cls);
    const handler = { handle: vi.fn(() => of('downstream-value')) };
    const stream = interceptor.intercept(makeHost({}), handler);
    const value = await new Promise((resolve) => stream.subscribe(resolve));
    expect(handler.handle).toHaveBeenCalledOnce();
    expect(value).toBe('downstream-value');
  });
});
