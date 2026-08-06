import { describe, expect, it } from 'vitest';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ClsModule, ClsService, ClsServiceManager } from 'nestjs-cls';
import { Test } from '@nestjs/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { CLS_TRACE_ID, CLS_USER_ID, CLS_WORKSPACE_ID } from '../common/cls/cls-keys';
import { SOCKET_USER_KEY } from './ws-auth.guard';
import { WsClsInterceptor } from './ws-cls.interceptor';

function wsContext(handlerName: string, socketData: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'ws',
    getHandler: () => ({ name: handlerName }),
    switchToWs: () => ({ getClient: () => ({ id: 'sock-1', data: socketData }) }),
  } as unknown as ExecutionContext;
}

async function makeInterceptor(): Promise<WsClsInterceptor> {
  const moduleRef = await Test.createTestingModule({
    imports: [ClsModule.forRoot()],
    providers: [WsClsInterceptor],
  }).compile();
  return moduleRef.get(WsClsInterceptor);
}

describe('WsClsInterceptor', () => {
  it('bypasses non-ws contexts', async () => {
    const interceptor = await makeInterceptor();
    const ctx = { getType: () => 'http' } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('ok') };
    const result = await firstValueFrom(interceptor.intercept(ctx, next));
    expect(result).toBe('ok');
  });

  it('seeds CLS with traceId, userId, and workspaceId inside the handler', async () => {
    const interceptor = await makeInterceptor();
    const cls = ClsServiceManager.getClsService();

    let captured: Record<string, unknown> = {};
    const next: CallHandler = {
      handle: () =>
        of(
          (() => {
            captured = {
              trace: cls.get(CLS_TRACE_ID),
              user: cls.get(CLS_USER_ID),
              workspace: cls.get(CLS_WORKSPACE_ID),
            };
            return 'done';
          })(),
        ),
    };

    const ctx = wsContext('onSubscribeTask', {
      [SOCKET_USER_KEY]: { userId: 'user-1' },
      workspaceId: 'ws-1',
    });
    const result = await firstValueFrom(interceptor.intercept(ctx, next));
    expect(result).toBe('done');
    expect(captured['user']).toBe('user-1');
    expect(captured['workspace']).toBe('ws-1');
    expect(typeof captured['trace']).toBe('string');
    expect((captured['trace'] as string).length).toBe(32);
  });

  it('propagates handler errors', async () => {
    const interceptor = await makeInterceptor();
    const next: CallHandler = { handle: () => throwError(() => new Error('nope')) };
    const ctx = wsContext('onSubscribeTask', {
      [SOCKET_USER_KEY]: { userId: 'user-1' },
      workspaceId: 'ws-1',
    });
    await expect(firstValueFrom(interceptor.intercept(ctx, next))).rejects.toThrow('nope');
  });

  it('runs without workspaceId or userId when the socket has no data', async () => {
    const interceptor = await makeInterceptor();
    const cls = ClsServiceManager.getClsService();
    let userSeen: unknown = 'not-set';
    const next: CallHandler = {
      handle: () =>
        of(
          (() => {
            userSeen = cls.get(CLS_USER_ID);
            return 'ok';
          })(),
        ),
    };
    const ctx = wsContext('onSubscribeTask', {});
    const result = await firstValueFrom(interceptor.intercept(ctx, next));
    expect(result).toBe('ok');
    expect(userSeen).toBeUndefined();
  });
});

// Silence "unused" if the linter picks it up
export { ClsService };
