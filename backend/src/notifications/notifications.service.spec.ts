import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisConnectionFactory } from '../common/redis/redis-connection.factory';
import type { PreferencesService } from './preferences.service';
import type { InAppChannel } from './channels/in-app.channel';
import { NotificationsService } from './notifications.service';

function fakeRedis(): Redis {
  const store = new Map<string, string>();
  return {
    async set(key: string, _value: string, _px: 'PX', _ttl: number, _nx: 'NX') {
      if (store.has(key)) return null;
      store.set(key, '1');
      return 'OK';
    },
  } as unknown as Redis;
}

interface Deps {
  create: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  queueAdd: ReturnType<typeof vi.fn>;
  deliver: ReturnType<typeof vi.fn>;
  getEffective: ReturnType<typeof vi.fn>;
  redis: Redis;
}

function makeService(): { service: NotificationsService; deps: Deps } {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `nfy-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date('2026-07-27T12:00:00Z'),
    readAt: null,
    ...data,
  }));
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const updateMany = vi.fn().mockResolvedValue({ count: 0 });
  const findFirst = vi.fn().mockResolvedValue(null);
  const queueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
  const deliver = vi.fn().mockResolvedValue(undefined);
  const getEffective = vi.fn().mockResolvedValue({
    COMMENT_MENTION: { IN_APP: true, EMAIL: true, PUSH: false },
    TASK_ASSIGNED: { IN_APP: true, EMAIL: true, PUSH: false },
    COMMENT_FOLLOWED: { IN_APP: true, EMAIL: false, PUSH: false },
    SPRINT_LIFECYCLE: { IN_APP: false, EMAIL: false, PUSH: false },
  });
  const redis = fakeRedis();

  const prisma = {
    forSystem: () => ({
      notification: { create, findMany, count, updateMany, findFirst },
    }),
  } as unknown as PrismaService;
  const preferences = { getEffective } as unknown as PreferencesService;
  const inApp = { deliver } as unknown as InAppChannel;
  const queue = { add: queueAdd } as unknown as Queue;
  const config = {
    get: (key: string, fallback: unknown) => (key === 'NOTIF_DEDUPE_WINDOW_S' ? 60 : fallback),
  } as unknown as ConfigService;
  const factory = { create: () => redis } as unknown as RedisConnectionFactory;

  const service = new NotificationsService(prisma, preferences, inApp, queue, config, factory);
  return {
    service,
    deps: {
      create,
      findMany,
      count,
      updateMany,
      findFirst,
      queueAdd,
      deliver,
      getEffective,
      redis,
    },
  };
}

const BASE_INPUT = {
  workspaceId: 'ws-1',
  eventType: 'COMMENT_MENTION' as const,
  actorUserId: 'actor-1',
  recipients: ['user-a', 'user-b'],
  sourceEntity: { kind: 'COMMENT' as const, id: 'c-1' },
  payload: { commentExcerpt: 'hi' },
};

describe('NotificationsService.notify', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates one row per recipient and one fan-out job per channel-enabled recipient', async () => {
    const { service, deps } = makeService();
    await service.notify(BASE_INPUT);
    expect(deps.create).toHaveBeenCalledTimes(2);
    expect(deps.deliver).toHaveBeenCalledTimes(2);
    // Both recipients have EMAIL=true on COMMENT_MENTION → 2 fan-out jobs.
    expect(deps.queueAdd).toHaveBeenCalledTimes(2);
  });

  it('excludes the actor even if listed as a recipient', async () => {
    const { service, deps } = makeService();
    await service.notify({ ...BASE_INPUT, recipients: ['actor-1', 'user-a'] });
    expect(deps.create).toHaveBeenCalledTimes(1);
    const arg = deps.create.mock.calls[0]![0] as { data: { recipientUserId: string } };
    expect(arg.data.recipientUserId).toBe('user-a');
  });

  it('dedups the same (event, recipient, source) within the TTL window', async () => {
    const { service, deps } = makeService();
    await service.notify({ ...BASE_INPUT, recipients: ['user-a'] });
    await service.notify({ ...BASE_INPUT, recipients: ['user-a'] });
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.queueAdd).toHaveBeenCalledTimes(1);
  });

  it('skips row creation and fan-out when every channel is disabled', async () => {
    const { service, deps } = makeService();
    // SPRINT_LIFECYCLE is all-off in the fake preferences map.
    await service.notify({
      ...BASE_INPUT,
      eventType: 'SPRINT_LIFECYCLE',
      recipients: ['user-a'],
      sourceEntity: { kind: 'SPRINT', id: 's-1' },
    });
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.queueAdd).not.toHaveBeenCalled();
  });

  it('creates a row for IN_APP-only events and skips fan-out enqueue', async () => {
    const { service, deps } = makeService();
    await service.notify({
      ...BASE_INPUT,
      eventType: 'COMMENT_FOLLOWED',
      recipients: ['user-a'],
    });
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    // COMMENT_FOLLOWED has IN_APP true, EMAIL/PUSH false → no fan-out job.
    expect(deps.queueAdd).not.toHaveBeenCalled();
  });

  it('deduplicates recipients (same user twice in the input list produces one row)', async () => {
    const { service, deps } = makeService();
    await service.notify({ ...BASE_INPUT, recipients: ['user-a', 'user-a'] });
    expect(deps.create).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the recipient list resolves to empty after actor filter', async () => {
    const { service, deps } = makeService();
    await service.notify({ ...BASE_INPUT, recipients: ['actor-1'] });
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.queueAdd).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.list', () => {
  it('scopes the query by (recipient, workspace) and returns nextCursor when hasMore', async () => {
    const { service, deps } = makeService();
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `n-${i}`, createdAt: new Date() }));
    deps.findMany.mockResolvedValueOnce(rows);
    const result = await service.list('user-a', 'ws-1', {
      limit: 50,
      unreadOnly: false,
    });
    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe('n-49');
    const arg = deps.findMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(arg.where).toMatchObject({ recipientUserId: 'user-a', workspaceId: 'ws-1' });
    expect(arg.take).toBe(51);
  });

  it('applies unreadOnly and type filters when set', async () => {
    const { service, deps } = makeService();
    await service.list('user-a', 'ws-1', {
      limit: 25,
      unreadOnly: true,
      type: 'TASK_ASSIGNED',
    });
    const arg = deps.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({ readAt: null, eventType: 'TASK_ASSIGNED' });
  });
});

describe('NotificationsService.markRead', () => {
  it('returns true when a row transitions to read', async () => {
    const { service, deps } = makeService();
    deps.updateMany.mockResolvedValueOnce({ count: 1 });
    const ok = await service.markRead('n-1', 'user-a', 'ws-1');
    expect(ok).toBe(true);
  });

  it('returns true for an already-read row that still belongs to the user', async () => {
    const { service, deps } = makeService();
    deps.updateMany.mockResolvedValueOnce({ count: 0 });
    deps.findFirst.mockResolvedValueOnce({ id: 'n-1' });
    const ok = await service.markRead('n-1', 'user-a', 'ws-1');
    expect(ok).toBe(true);
  });

  it('returns false when the row is missing or belongs to another user', async () => {
    const { service, deps } = makeService();
    deps.updateMany.mockResolvedValueOnce({ count: 0 });
    deps.findFirst.mockResolvedValueOnce(null);
    const ok = await service.markRead('n-1', 'user-a', 'ws-1');
    expect(ok).toBe(false);
  });
});

describe('NotificationsService.markAllRead', () => {
  it('reports the updated count', async () => {
    const { service, deps } = makeService();
    deps.updateMany.mockResolvedValueOnce({ count: 7 });
    const result = await service.markAllRead('user-a', 'ws-1');
    expect(result).toEqual({ updated: 7 });
  });
});
