import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskCommentsService } from './task-comments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskEvents } from '../events/task.events';

const WS = 'ws-1';
const PROJECT = 'proj-1';
const TASK = 'task-1';
const COMMENT = 'comment-1';
const AUTHOR = 'user-author';
const OTHER = 'user-other';

const taskClient = { findUnique: vi.fn() };
const commentClient = {
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

const rawClient = { task: taskClient, comment: commentClient };
const mockPrisma = { forSystem: vi.fn(() => rawClient) };
const emit = vi.fn();

async function buildService(): Promise<TaskCommentsService> {
  const module = await Test.createTestingModule({
    providers: [
      TaskCommentsService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: EventEmitter2, useValue: { emit } },
    ],
  }).compile();
  return module.get(TaskCommentsService);
}

beforeEach(() => vi.clearAllMocks());

describe('TaskCommentsService.create', () => {
  it('creates a comment and emits COMMENT_ADDED', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: WS, deletedAt: null });
    commentClient.create.mockResolvedValueOnce({
      id: COMMENT,
      workspaceId: WS,
      taskId: TASK,
      authorUserId: AUTHOR,
      body: 'hello',
    });

    await service.create({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      body: 'hello',
      actorUserId: AUTHOR,
    });
    expect(emit).toHaveBeenCalledWith(
      TaskEvents.COMMENT_ADDED,
      expect.objectContaining({ commentId: COMMENT, taskId: TASK }),
    );
  });

  it('throws NotFoundException on cross-workspace task', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: 'other', deletedAt: null });
    await expect(
      service.create({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: TASK,
        body: 'x',
        actorUserId: AUTHOR,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TaskCommentsService.update', () => {
  it('lets the author edit their own comment', async () => {
    const service = await buildService();
    commentClient.findUnique.mockResolvedValueOnce({
      id: COMMENT,
      workspaceId: WS,
      authorUserId: AUTHOR,
      deletedAt: null,
    });
    commentClient.update.mockResolvedValueOnce({ id: COMMENT, body: 'updated' });

    await service.update({
      workspaceId: WS,
      commentId: COMMENT,
      body: 'updated',
      actorUserId: AUTHOR,
      actorRole: 'MEMBER',
    });
    expect(commentClient.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { body: 'updated' } }),
    );
  });

  it("blocks edits by a non-author even if role is ADMIN", async () => {
    const service = await buildService();
    commentClient.findUnique.mockResolvedValueOnce({
      id: COMMENT,
      workspaceId: WS,
      authorUserId: AUTHOR,
      deletedAt: null,
    });

    try {
      await service.update({
        workspaceId: WS,
        commentId: COMMENT,
        body: 'silent-edit',
        actorUserId: OTHER,
        actorRole: 'ADMIN',
      });
      expect.fail('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as { type: string };
      expect(response.type).toBe('https://tasker.dev/problems/comment-edit-forbidden');
    }
  });
});

describe('TaskCommentsService.remove', () => {
  it('lets the author delete their own comment', async () => {
    const service = await buildService();
    commentClient.findUnique.mockResolvedValueOnce({
      id: COMMENT,
      workspaceId: WS,
      authorUserId: AUTHOR,
      deletedAt: null,
    });
    await service.remove({
      workspaceId: WS,
      commentId: COMMENT,
      actorUserId: AUTHOR,
      actorRole: 'MEMBER',
    });
    expect(commentClient.delete).toHaveBeenCalled();
  });

  it('403 when a MEMBER tries to delete someone else\'s comment', async () => {
    const service = await buildService();
    commentClient.findUnique.mockResolvedValueOnce({
      id: COMMENT,
      workspaceId: WS,
      authorUserId: AUTHOR,
      deletedAt: null,
    });
    try {
      await service.remove({
        workspaceId: WS,
        commentId: COMMENT,
        actorUserId: OTHER,
        actorRole: 'MEMBER',
      });
      expect.fail('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as { type: string };
      expect(response.type).toBe('https://tasker.dev/problems/comment-delete-forbidden');
    }
  });

  it('OWNER can delete any comment', async () => {
    const service = await buildService();
    commentClient.findUnique.mockResolvedValueOnce({
      id: COMMENT,
      workspaceId: WS,
      authorUserId: AUTHOR,
      deletedAt: null,
    });
    await service.remove({
      workspaceId: WS,
      commentId: COMMENT,
      actorUserId: OTHER,
      actorRole: 'OWNER',
    });
    expect(commentClient.delete).toHaveBeenCalled();
  });

  it('404 when the comment lives in another workspace', async () => {
    const service = await buildService();
    commentClient.findUnique.mockResolvedValueOnce({
      id: COMMENT,
      workspaceId: 'other',
      authorUserId: AUTHOR,
      deletedAt: null,
    });
    await expect(
      service.remove({
        workspaceId: WS,
        commentId: COMMENT,
        actorUserId: AUTHOR,
        actorRole: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
