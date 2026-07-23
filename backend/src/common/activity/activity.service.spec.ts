import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { ActivityBus } from './activity.bus';
import { ActivityService, ActivityEntry } from './activity.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrismaMock() {
  const findMany = vi.fn().mockResolvedValue([]);
  const raw = {
    activity: { findMany },
  };
  const prisma = {
    forSystem: () => raw,
  } as unknown as PrismaService;
  return { prisma, findMany };
}

function makeTxMock() {
  const create = vi.fn(async ({ data }: { data: unknown }) => ({
    id: 'a-1',
    createdAt: new Date('2026-07-23T00:00:00Z'),
    ...(data as Record<string, unknown>),
  }));
  const tx = { activity: { create } } as unknown as Prisma.TransactionClient;
  return { tx, create };
}

describe('ActivityService', () => {
  let emitter: EventEmitter2;
  let bus: ActivityBus;

  beforeEach(() => {
    emitter = new EventEmitter2({ wildcard: false, delimiter: '.' });
    bus = new ActivityBus(emitter);
  });

  describe('record()', () => {
    it('writes an Activity row using the caller-supplied tx client', async () => {
      const { prisma } = makePrismaMock();
      const { tx, create } = makeTxMock();
      const svc = new ActivityService(prisma, bus);

      const entry: ActivityEntry = {
        workspaceId: 'ws-1',
        projectId: 'p-1',
        taskId: 't-1',
        actorUserId: 'u-1',
        verb: 'comment.created',
        payload: { actorDisplayName: 'Ana', commentExcerpt: 'hi' },
      };
      await svc.record(tx, entry);

      expect(create).toHaveBeenCalledTimes(1);
      const arg = create.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(arg.data.workspaceId).toBe('ws-1');
      expect(arg.data.projectId).toBe('p-1');
      expect(arg.data.taskId).toBe('t-1');
      expect(arg.data.actorUserId).toBe('u-1');
      expect(arg.data.verb).toBe('comment.created');
      expect(arg.data.payload).toEqual({ actorDisplayName: 'Ana', commentExcerpt: 'hi' });
    });

    it('publishes an ActivityBus event with the created row id', async () => {
      const { prisma } = makePrismaMock();
      const { tx } = makeTxMock();
      const svc = new ActivityService(prisma, bus);
      const received: unknown[] = [];
      bus.onAny((e) => received.push(e));

      await svc.record(tx, {
        workspaceId: 'ws-1',
        projectId: 'p-1',
        verb: 'task.created',
        payload: { targetTitle: 'Do the thing' },
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        workspaceId: 'ws-1',
        projectId: 'p-1',
        verb: 'task.created',
        activityId: 'a-1',
      });
    });

    it('defaults taskId and actorUserId to null when omitted', async () => {
      const { prisma } = makePrismaMock();
      const { tx, create } = makeTxMock();
      const svc = new ActivityService(prisma, bus);

      await svc.record(tx, {
        workspaceId: 'ws-1',
        projectId: 'p-1',
        verb: 'task.deleted',
        payload: {},
      });

      const arg = create.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(arg.data.taskId).toBeNull();
      expect(arg.data.actorUserId).toBeNull();
    });

    it('accepts every documented verb', async () => {
      const { prisma } = makePrismaMock();
      const { tx, create } = makeTxMock();
      const svc = new ActivityService(prisma, bus);
      const verbs = [
        'task.created',
        'task.updated',
        'task.deleted',
        'task.status_changed',
        'comment.created',
        'comment.edited',
        'comment.deleted',
        'reaction.added',
        'reaction.removed',
        'attachment.uploaded',
        'attachment.removed',
      ] as const;
      for (const verb of verbs) {
        await svc.record(tx, {
          workspaceId: 'ws-1',
          projectId: 'p-1',
          verb,
          payload: {},
        });
      }
      expect(create).toHaveBeenCalledTimes(verbs.length);
    });
  });

  describe('list feeds', () => {
    it('scopes by taskId and returns newest-first ordering', async () => {
      const { prisma, findMany } = makePrismaMock();
      const svc = new ActivityService(prisma, bus);
      await svc.listForTask('ws-1', 't-1');
      const args = findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
        orderBy: unknown;
        take: number;
      };
      expect(args.where).toMatchObject({ workspaceId: 'ws-1', taskId: 't-1' });
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(args.take).toBe(51); // limit + 1 sentinel
    });

    it('scopes by projectId when requested', async () => {
      const { prisma, findMany } = makePrismaMock();
      const svc = new ActivityService(prisma, bus);
      await svc.listForProject('ws-1', 'p-1');
      const args = findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(args.where).toMatchObject({ workspaceId: 'ws-1', projectId: 'p-1' });
    });

    it('clamps limit to MAX 100', async () => {
      const { prisma, findMany } = makePrismaMock();
      const svc = new ActivityService(prisma, bus);
      await svc.listForTask('ws-1', 't-1', { limit: 9999 });
      const args = findMany.mock.calls[0]![0] as { take: number };
      expect(args.take).toBe(101);
    });

    it('forwards cursor + skip when a cursor is provided', async () => {
      const { prisma, findMany } = makePrismaMock();
      const svc = new ActivityService(prisma, bus);
      await svc.listForTask('ws-1', 't-1', { cursor: 'a-42', limit: 10 });
      const args = findMany.mock.calls[0]![0] as {
        cursor?: { id: string };
        skip?: number;
        take?: number;
      };
      expect(args.cursor).toEqual({ id: 'a-42' });
      expect(args.skip).toBe(1);
      expect(args.take).toBe(11);
    });

    it('emits a nextCursor when there is a next page', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({
        id: `a-${i}`,
        workspaceId: 'ws-1',
        projectId: 'p-1',
        taskId: 't-1',
        actorUserId: null,
        verb: 'comment.created',
        payload: {},
        createdAt: new Date(),
      }));
      const { prisma, findMany } = makePrismaMock();
      findMany.mockResolvedValueOnce(rows);
      const svc = new ActivityService(prisma, bus);
      const page = await svc.listForTask('ws-1', 't-1', { limit: 3 });
      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).toBe('a-2');
    });

    it('emits nextCursor = null when the last page fits', async () => {
      const rows = Array.from({ length: 2 }, (_, i) => ({
        id: `a-${i}`,
        workspaceId: 'ws-1',
        projectId: 'p-1',
        taskId: 't-1',
        actorUserId: null,
        verb: 'comment.created',
        payload: {},
        createdAt: new Date(),
      }));
      const { prisma, findMany } = makePrismaMock();
      findMany.mockResolvedValueOnce(rows);
      const svc = new ActivityService(prisma, bus);
      const page = await svc.listForTask('ws-1', 't-1', { limit: 3 });
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });
  });
});
