import { describe, it, expect, vi } from 'vitest';
import { WsException } from '@nestjs/websockets';
import type { ExecutionContext } from '@nestjs/common';
import { WsWorkspaceGuard } from './ws-workspace.guard';
import { SOCKET_USER_KEY } from './ws-auth.guard';
import type { PrismaService } from '../prisma/prisma.service';

function contextWith(data: Record<string, unknown>): ExecutionContext {
  return {
    switchToWs: () => ({ getClient: () => ({ id: 'sock-1', data }) }),
  } as unknown as ExecutionContext;
}

function prismaWith(findResult: { id: string } | null): PrismaService {
  return {
    forSystem: () => ({
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue(findResult),
      },
    }),
  } as unknown as PrismaService;
}

describe('WsWorkspaceGuard', () => {
  it('accepts a member', async () => {
    const guard = new WsWorkspaceGuard(prismaWith({ id: 'm-1' }));
    const ctx = contextWith({
      [SOCKET_USER_KEY]: { userId: 'user-1' },
      workspaceId: 'ws-1',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a non-member', async () => {
    const guard = new WsWorkspaceGuard(prismaWith(null));
    const ctx = contextWith({
      [SOCKET_USER_KEY]: { userId: 'user-1' },
      workspaceId: 'ws-1',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(WsException);
  });

  it('rejects when workspaceId is missing', async () => {
    const guard = new WsWorkspaceGuard(prismaWith({ id: 'm-1' }));
    const ctx = contextWith({ [SOCKET_USER_KEY]: { userId: 'user-1' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(WsException);
  });

  it('rejects when user is missing', async () => {
    const guard = new WsWorkspaceGuard(prismaWith({ id: 'm-1' }));
    const ctx = contextWith({ workspaceId: 'ws-1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(WsException);
  });
});
