import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import type { WorkspaceContext } from '../common/context/workspace-context.store';
import type { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

function reqWith(ctx: WorkspaceContext | undefined): ExpressRequest & {
  workspaceContext?: WorkspaceContext;
} {
  return { workspaceContext: ctx } as ExpressRequest & { workspaceContext?: WorkspaceContext };
}

const CTX: WorkspaceContext = {
  userId: 'user-a',
  workspaceId: 'ws-1',
  role: 'MEMBER',
  membershipId: 'm-1',
};

function makeController() {
  const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  const unreadCount = vi.fn().mockResolvedValue(3);
  const markRead = vi.fn().mockResolvedValue(true);
  const markAllRead = vi.fn().mockResolvedValue({ updated: 5 });
  const service = { list, unreadCount, markRead, markAllRead } as unknown as NotificationsService;
  return {
    controller: new NotificationsController(service),
    list,
    unreadCount,
    markRead,
    markAllRead,
  };
}

describe('NotificationsController', () => {
  it('rejects requests without a workspace context (missing X-Workspace-Id)', async () => {
    const { controller } = makeController();
    await expect(
      controller.list(
        { cursor: undefined, limit: 50, unreadOnly: false, type: undefined } as never,
        reqWith(undefined),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forwards list query args scoped to the resolved user + workspace', async () => {
    const { controller, list } = makeController();
    await controller.list(
      { cursor: 'abc', limit: 25, unreadOnly: true, type: 'COMMENT_MENTION' } as never,
      reqWith(CTX),
    );
    expect(list).toHaveBeenCalledWith('user-a', 'ws-1', {
      cursor: 'abc',
      limit: 25,
      unreadOnly: true,
      type: 'COMMENT_MENTION',
    });
  });

  it('returns { count } for GET /unread-count', async () => {
    const { controller } = makeController();
    const result = await controller.unreadCount(reqWith(CTX));
    expect(result).toEqual({ count: 3 });
  });

  it('204s on markRead when the notification exists', async () => {
    const { controller } = makeController();
    await expect(controller.markRead('n-1', reqWith(CTX))).resolves.toBeUndefined();
  });

  it('404s on markRead when the notification does not belong to the user/workspace', async () => {
    const { controller, markRead } = makeController();
    markRead.mockResolvedValueOnce(false);
    await expect(controller.markRead('n-1', reqWith(CTX))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the updated count on markAllRead', async () => {
    const { controller } = makeController();
    const result = await controller.markAllRead(reqWith(CTX));
    expect(result).toEqual({ updated: 5 });
  });
});
