import { describe, it, expect } from 'vitest';
import { WsException } from '@nestjs/websockets';
import type { ExecutionContext } from '@nestjs/common';
import { WsAuthGuard, SOCKET_USER_KEY } from './ws-auth.guard';

function contextWith(data: Record<string, unknown>): ExecutionContext {
  return {
    switchToWs: () => ({
      getClient: () => ({ id: 'sock-1', data }),
    }),
  } as unknown as ExecutionContext;
}

describe('WsAuthGuard', () => {
  const guard = new WsAuthGuard();

  it('accepts a socket with an authenticated user', () => {
    const ctx = contextWith({ [SOCKET_USER_KEY]: { userId: 'user-1' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a socket with no user', () => {
    const ctx = contextWith({});
    expect(() => guard.canActivate(ctx)).toThrow(WsException);
  });

  it('rejects a socket where user has no userId', () => {
    const ctx = contextWith({ [SOCKET_USER_KEY]: {} });
    expect(() => guard.canActivate(ctx)).toThrow(WsException);
  });
});
