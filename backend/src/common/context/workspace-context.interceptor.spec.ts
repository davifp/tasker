import { describe, it, expect } from 'vitest';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import { WorkspaceContextInterceptor } from './workspace-context.interceptor';
import { WorkspaceContext, WorkspaceContextStore } from './workspace-context.store';

const makeCtx = (workspaceId: string): WorkspaceContext => ({
  userId: 'user-1',
  workspaceId,
  role: 'MEMBER',
  membershipId: 'mem-1',
});

function makeExecutionContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('WorkspaceContextInterceptor', () => {
  it('passes through when the request has no workspace context', async () => {
    const store = new WorkspaceContextStore();
    const interceptor = new WorkspaceContextInterceptor(store);
    const req = {};
    const next: CallHandler = { handle: () => defer(async () => ({ ok: true })) };

    const result = await firstValueFrom(interceptor.intercept(makeExecutionContext(req), next));

    expect(result).toEqual({ ok: true });
    expect(store.get()).toBeUndefined();
  });

  it('exposes the workspace context to async work inside the handler', async () => {
    const store = new WorkspaceContextStore();
    const interceptor = new WorkspaceContextInterceptor(store);
    const ctx = makeCtx('ws-1');
    const req = { workspaceContext: ctx };
    const seen: (WorkspaceContext | undefined)[] = [];

    const next: CallHandler = {
      handle: () =>
        defer(async () => {
          seen.push(store.get());
          // Yield across microtasks to prove ALS propagates through awaits.
          await new Promise<void>((resolve) => setImmediate(resolve));
          seen.push(store.get());
          return { ok: true };
        }),
    };

    const result = await firstValueFrom(interceptor.intercept(makeExecutionContext(req), next));

    expect(result).toEqual({ ok: true });
    expect(seen).toEqual([ctx, ctx]);
    expect(store.get()).toBeUndefined();
  });

  it('isolates concurrent requests so each sees only its own workspace', async () => {
    const store = new WorkspaceContextStore();
    const interceptor = new WorkspaceContextInterceptor(store);
    const ctxA = makeCtx('ws-A');
    const ctxB = makeCtx('ws-B');
    const seen: string[] = [];

    const nextFor = (delayMs: number): CallHandler => ({
      handle: () =>
        defer(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          seen.push(store.require().workspaceId);
          return null;
        }),
    });

    await Promise.all([
      firstValueFrom(
        interceptor.intercept(makeExecutionContext({ workspaceContext: ctxA }), nextFor(10)),
      ),
      firstValueFrom(
        interceptor.intercept(makeExecutionContext({ workspaceContext: ctxB }), nextFor(0)),
      ),
    ]);

    expect(seen).toEqual(['ws-B', 'ws-A']);
  });
});
