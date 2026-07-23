import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskCommentsService } from './task-comments.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../../common/activity/activity.service';
import { MentionParser } from './mentions/mention-parser';
import { MentionsService, type ResolvedMention } from './mentions/mentions.service';
import type { Queue } from 'bullmq';

const WS = 'ws-1';
const PROJECT = 'proj-1';
const TASK = 'task-1';
const COMMENT = 'comment-1';
const AUTHOR = 'user-author';
const OTHER = 'user-other';

function makeSuite(opts: {
  resolveMentions?: ResolvedMention[];
  existingComment?: {
    workspaceId?: string;
    authorUserId?: string;
    deletedAt?: Date | null;
    taskId?: string;
    task?: { projectId: string; title: string };
  } | null;
} = {}) {
  const queueAdd = vi.fn().mockResolvedValue({});
  const notifications = { add: queueAdd } as unknown as Queue;

  const activityRecord = vi.fn().mockResolvedValue(undefined);
  const activity = { record: activityRecord } as unknown as ActivityService;

  const parser = new MentionParser();
  const mentionsResolve = vi.fn().mockResolvedValue(opts.resolveMentions ?? []);
  const mentions = { resolve: mentionsResolve } as unknown as MentionsService;

  const taskFindUnique = vi.fn().mockResolvedValue({
    workspaceId: WS,
    projectId: PROJECT,
    deletedAt: null,
    title: 'Do it',
  });
  const commentCreate = vi.fn().mockResolvedValue({
    id: COMMENT,
    workspaceId: WS,
    taskId: TASK,
    authorUserId: AUTHOR,
    body: 'hello',
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const commentFindUnique = vi.fn().mockResolvedValue(
    opts.existingComment === undefined
      ? {
          id: COMMENT,
          workspaceId: WS,
          authorUserId: AUTHOR,
          taskId: TASK,
          deletedAt: null,
          task: { projectId: PROJECT, title: 'Do it' },
          ...(opts.existingComment ?? {}),
        }
      : opts.existingComment,
  );
  const commentUpdate = vi.fn().mockImplementation(async ({ data }: { data: unknown }) => ({
    id: COMMENT,
    workspaceId: WS,
    taskId: TASK,
    authorUserId: AUTHOR,
    body: 'updated',
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(data as Record<string, unknown>),
  }));
  const commentFindMany = vi.fn().mockResolvedValue([]);
  const commentMentionFindMany = vi.fn().mockResolvedValue([]);
  const commentMentionCreateMany = vi.fn().mockResolvedValue({ count: 0 });
  const commentMentionDeleteMany = vi.fn().mockResolvedValue({ count: 0 });

  const txClient = {
    comment: {
      create: commentCreate,
      update: commentUpdate,
      findMany: commentFindMany,
    },
    commentMention: {
      findMany: commentMentionFindMany,
      createMany: commentMentionCreateMany,
      deleteMany: commentMentionDeleteMany,
    },
    workspaceMember: { findMany: vi.fn().mockResolvedValue([]) },
    activity: { create: vi.fn().mockResolvedValue({ id: 'a-1' }) },
  };

  const rawClient = {
    task: { findUnique: taskFindUnique },
    comment: { findUnique: commentFindUnique, findMany: commentFindMany },
    $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
  };

  const prisma = { forSystem: () => rawClient } as unknown as PrismaService;

  const service = new TaskCommentsService(
    prisma,
    new EventEmitter2(),
    activity,
    parser,
    mentions,
    notifications,
  );

  return {
    service,
    queueAdd,
    activityRecord,
    mentionsResolve,
    commentCreate,
    commentUpdate,
    commentMentionCreateMany,
    commentMentionDeleteMany,
    commentMentionFindMany,
    taskFindUnique,
    commentFindUnique,
    rawClient,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('TaskCommentsService.create', () => {
  it('writes comment, mentions, and activity inside a single transaction', async () => {
    const s = makeSuite({
      resolveMentions: [
        { userId: 'u-ana', displayName: 'Ana', handle: 'ana', offset: 6 },
      ],
    });
    await s.service.create({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      body: 'ping @ana please',
      actorUserId: AUTHOR,
    });
    expect(s.commentCreate).toHaveBeenCalledTimes(1);
    expect(s.commentMentionCreateMany).toHaveBeenCalledTimes(1);
    expect(s.activityRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'comment.created' }),
    );
  });

  it('enqueues one notification job per resolved mention AFTER commit', async () => {
    const s = makeSuite({
      resolveMentions: [
        { userId: 'u-ana', displayName: 'Ana', handle: 'ana', offset: 0 },
        { userId: 'u-bob', displayName: 'Bob', handle: 'bob', offset: 10 },
      ],
    });
    await s.service.create({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      body: '@ana and @bob',
      actorUserId: AUTHOR,
    });
    expect(s.queueAdd).toHaveBeenCalledTimes(2);
    expect(s.queueAdd).toHaveBeenCalledWith(
      'comment.mention',
      expect.objectContaining({
        type: 'comment.mention',
        workspaceId: WS,
        mentionedUserId: 'u-ana',
        actorUserId: AUTHOR,
      }),
    );
  });

  it('does not enqueue anything when no mentions resolve', async () => {
    const s = makeSuite({ resolveMentions: [] });
    await s.service.create({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      body: 'no mentions here',
      actorUserId: AUTHOR,
    });
    expect(s.queueAdd).not.toHaveBeenCalled();
    expect(s.commentMentionCreateMany).not.toHaveBeenCalled();
  });

  it('rejects when the task is not in the caller workspace', async () => {
    const s = makeSuite();
    s.taskFindUnique.mockResolvedValueOnce({
      workspaceId: 'other',
      projectId: PROJECT,
      deletedAt: null,
      title: 'x',
    });
    await expect(
      s.service.create({
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
  it('sets editedAt and emits comment.edited activity', async () => {
    const s = makeSuite();
    await s.service.update({
      workspaceId: WS,
      commentId: COMMENT,
      body: 'edited',
      actorUserId: AUTHOR,
      actorRole: 'MEMBER',
    });
    const arg = s.commentUpdate.mock.calls[0]![0] as { data: { editedAt?: unknown } };
    expect(arg.data.editedAt).toBeInstanceOf(Date);
    expect(s.activityRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'comment.edited' }),
    );
  });

  it('diffs mentions on edit: removes users no longer mentioned, adds new ones', async () => {
    const s = makeSuite({
      resolveMentions: [
        { userId: 'u-ana', displayName: 'Ana', handle: 'ana', offset: 0 },
        { userId: 'u-carol', displayName: 'Carol', handle: 'carol', offset: 5 },
      ],
    });
    // Currently mentioned: bob (to remove) + ana (to keep).
    s.commentMentionFindMany.mockResolvedValueOnce([
      { mentionedUserId: 'u-ana', offset: 0 },
      { mentionedUserId: 'u-bob', offset: 5 },
    ]);
    await s.service.update({
      workspaceId: WS,
      commentId: COMMENT,
      body: '@ana @carol',
      actorUserId: AUTHOR,
      actorRole: 'MEMBER',
    });
    const removed = s.commentMentionDeleteMany.mock.calls[0]![0] as {
      where: { mentionedUserId: { in: string[] } };
    };
    expect(removed.where.mentionedUserId.in).toEqual(['u-bob']);
    const added = s.commentMentionCreateMany.mock.calls[0]![0] as {
      data: Array<{ mentionedUserId: string }>;
    };
    expect(added.data.map(d => d.mentionedUserId)).toEqual(['u-carol']);
  });

  it('enqueues notifications ONLY for newly-added mentions, not for retained ones', async () => {
    const s = makeSuite({
      resolveMentions: [
        { userId: 'u-ana', displayName: 'Ana', handle: 'ana', offset: 0 },
        { userId: 'u-carol', displayName: 'Carol', handle: 'carol', offset: 5 },
      ],
    });
    s.commentMentionFindMany.mockResolvedValueOnce([{ mentionedUserId: 'u-ana', offset: 0 }]);
    await s.service.update({
      workspaceId: WS,
      commentId: COMMENT,
      body: '@ana @carol',
      actorUserId: AUTHOR,
      actorRole: 'MEMBER',
    });
    expect(s.queueAdd).toHaveBeenCalledTimes(1);
    expect(s.queueAdd).toHaveBeenCalledWith(
      'comment.mention',
      expect.objectContaining({ mentionedUserId: 'u-carol' }),
    );
  });

  it('blocks edits by a non-author even if role is ADMIN', async () => {
    const s = makeSuite();
    try {
      await s.service.update({
        workspaceId: WS,
        commentId: COMMENT,
        body: 'silent-edit',
        actorUserId: OTHER,
        actorRole: 'ADMIN',
      });
      expect.fail('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const resp = (err as ForbiddenException).getResponse() as { type: string };
      expect(resp.type).toBe('https://tasker.dev/problems/comment-edit-forbidden');
    }
  });
});

describe('TaskCommentsService.remove (soft-delete)', () => {
  it('sets deletedAt (soft delete) and emits comment.deleted activity', async () => {
    const s = makeSuite();
    await s.service.remove({
      workspaceId: WS,
      commentId: COMMENT,
      actorUserId: AUTHOR,
      actorRole: 'MEMBER',
    });
    const updates = s.rawClient.$transaction.mock.calls;
    expect(updates).toHaveLength(1);
    expect(s.activityRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'comment.deleted' }),
    );
  });

  it('blocks a MEMBER from deleting someone else\'s comment', async () => {
    const s = makeSuite();
    try {
      await s.service.remove({
        workspaceId: WS,
        commentId: COMMENT,
        actorUserId: OTHER,
        actorRole: 'MEMBER',
      });
      expect.fail('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const resp = (err as ForbiddenException).getResponse() as { type: string };
      expect(resp.type).toBe('https://tasker.dev/problems/comment-delete-forbidden');
    }
  });

  it('allows an ADMIN to delete any comment', async () => {
    const s = makeSuite();
    await s.service.remove({
      workspaceId: WS,
      commentId: COMMENT,
      actorUserId: OTHER,
      actorRole: 'ADMIN',
    });
    expect(s.activityRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'comment.deleted' }),
    );
  });

  it('404 when the comment lives in another workspace', async () => {
    const s = makeSuite();
    s.commentFindUnique.mockResolvedValueOnce({
      id: COMMENT,
      workspaceId: 'other',
      authorUserId: AUTHOR,
      taskId: TASK,
      deletedAt: null,
      task: { projectId: PROJECT, title: 'x' },
    });
    await expect(
      s.service.remove({
        workspaceId: WS,
        commentId: COMMENT,
        actorUserId: AUTHOR,
        actorRole: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
