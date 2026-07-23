import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReactionsService } from './reactions.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ActivityService } from '../../../common/activity/activity.service';

const WS = 'ws-1';
const COMMENT = 'c-1';
const TASK = 't-1';
const PROJECT = 'p-1';
const USER = 'u-1';

function makeSuite(opts: {
  existing?: { commentId: string; userId: string; emoji: string } | null;
  comment?: {
    workspaceId?: string;
    taskId?: string;
    deletedAt?: Date | null;
    task?: { projectId: string };
  } | null;
} = {}) {
  const commentClient = {
    findUnique: vi.fn().mockResolvedValue(
      opts.comment === null
        ? null
        : {
            workspaceId: WS,
            taskId: TASK,
            deletedAt: null,
            task: { projectId: PROJECT },
            ...(opts.comment ?? {}),
          },
    ),
  };
  const reactionFindUnique = vi.fn().mockResolvedValue(
    opts.existing === undefined ? null : opts.existing,
  );
  const reactionCreate = vi.fn().mockImplementation(async ({ data }: { data: unknown }) => ({
    id: 'r-1',
    createdAt: new Date(),
    ...(data as Record<string, unknown>),
  }));
  const reactionDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const reactionFindMany = vi.fn().mockResolvedValue([]);

  const txClient = {
    commentReaction: {
      findUnique: reactionFindUnique,
      create: reactionCreate,
      deleteMany: reactionDeleteMany,
      findMany: reactionFindMany,
    },
    activity: { create: vi.fn().mockResolvedValue({ id: 'a-1' }) },
  };
  const raw = {
    comment: commentClient,
    commentReaction: {
      findMany: reactionFindMany,
      findUnique: reactionFindUnique,
    },
    $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
  };
  const prisma = { forSystem: () => raw } as unknown as PrismaService;
  const activityRecord = vi.fn().mockResolvedValue({});
  const activity = { record: activityRecord } as unknown as ActivityService;
  const svc = new ReactionsService(prisma, activity);
  return {
    svc,
    commentClient,
    reactionFindUnique,
    reactionCreate,
    reactionDeleteMany,
    reactionFindMany,
    activityRecord,
    raw,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('ReactionsService.add (catalog + idempotency)', () => {
  it('rejects an emoji outside the ReactionsCatalog', async () => {
    const s = makeSuite();
    try {
      await s.svc.add(COMMENT, 'poop', { workspaceId: WS, userId: USER });
      expect.fail('expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const resp = (err as BadRequestException).getResponse() as { type: string };
      expect(resp.type).toBe('https://tasker.dev/problems/reaction-not-allowed');
    }
  });

  it('creates a row when none exists and emits activity.reaction.added', async () => {
    const s = makeSuite({ existing: null });
    await s.svc.add(COMMENT, 'heart', { workspaceId: WS, userId: USER });
    expect(s.reactionCreate).toHaveBeenCalledTimes(1);
    expect(s.activityRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'reaction.added', payload: expect.objectContaining({ emoji: 'heart' }) }),
    );
  });

  it('is a no-op for an existing reaction (idempotent) and emits no activity', async () => {
    const s = makeSuite({
      existing: { commentId: COMMENT, userId: USER, emoji: 'heart' },
    });
    await s.svc.add(COMMENT, 'heart', { workspaceId: WS, userId: USER });
    expect(s.reactionCreate).not.toHaveBeenCalled();
    expect(s.activityRecord).not.toHaveBeenCalled();
  });

  it('404 when the comment is in another workspace', async () => {
    const s = makeSuite({ comment: { workspaceId: 'other' } });
    await expect(
      s.svc.add(COMMENT, 'heart', { workspaceId: WS, userId: USER }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects reacting to a soft-deleted comment', async () => {
    const s = makeSuite({ comment: { deletedAt: new Date() } });
    await expect(
      s.svc.add(COMMENT, 'heart', { workspaceId: WS, userId: USER }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ReactionsService.remove (idempotency)', () => {
  it('deletes the row and emits activity.reaction.removed when a row was there', async () => {
    const s = makeSuite();
    await s.svc.remove(COMMENT, 'heart', { workspaceId: WS, userId: USER });
    expect(s.reactionDeleteMany).toHaveBeenCalled();
    expect(s.activityRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'reaction.removed' }),
    );
  });

  it('is a no-op with no activity when the row did not exist', async () => {
    const s = makeSuite();
    s.reactionDeleteMany.mockResolvedValueOnce({ count: 0 });
    await s.svc.remove(COMMENT, 'heart', { workspaceId: WS, userId: USER });
    expect(s.activityRecord).not.toHaveBeenCalled();
  });

  it('rejects unknown emoji', async () => {
    const s = makeSuite();
    await expect(
      s.svc.remove(COMMENT, 'poop', { workspaceId: WS, userId: USER }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ReactionsService.list', () => {
  it('groups by emoji with count + bounded reactor sample + reactedByMe flag', async () => {
    const s = makeSuite();
    s.reactionFindMany.mockResolvedValueOnce([
      { emoji: 'heart', userId: 'u-1', user: { id: 'u-1', displayName: 'Ana' }, createdAt: new Date() },
      { emoji: 'heart', userId: 'u-2', user: { id: 'u-2', displayName: 'Bob' }, createdAt: new Date() },
      { emoji: 'rocket', userId: 'u-2', user: { id: 'u-2', displayName: 'Bob' }, createdAt: new Date() },
    ]);
    const out = await s.svc.list(COMMENT, { workspaceId: WS, userId: 'u-1' });
    const heart = out.find(o => o.emoji === 'heart')!;
    expect(heart.count).toBe(2);
    expect(heart.reactorSample.map(r => r.userId)).toEqual(['u-1', 'u-2']);
    expect(heart.reactedByMe).toBe(true);
    const rocket = out.find(o => o.emoji === 'rocket')!;
    expect(rocket.reactedByMe).toBe(false);
  });

  it('filters out stored rows whose emoji is no longer in the catalog', async () => {
    const s = makeSuite();
    s.reactionFindMany.mockResolvedValueOnce([
      { emoji: 'poop', userId: 'u-1', user: { id: 'u-1', displayName: 'X' }, createdAt: new Date() },
    ]);
    const out = await s.svc.list(COMMENT, { workspaceId: WS, userId: 'u-1' });
    expect(out).toEqual([]);
  });
});
