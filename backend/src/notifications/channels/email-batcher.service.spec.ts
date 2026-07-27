import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisConnectionFactory } from '../../common/redis/redis-connection.factory';
import type { MailProvider } from '../../common/mail/mail.provider';
import { EmailBatcher } from './email-batcher.service';
import { emailBucketIndexKey, emailBucketKey, type BufferedEmailItem } from './email.channel';

interface FakeRedis {
  lists: Map<string, string[]>;
  sets: Map<string, Set<string>>;
}

function fakeRedis(): { store: FakeRedis; instance: Redis } {
  const store: FakeRedis = { lists: new Map(), sets: new Map() };
  const instance = {
    async smembers(key: string) {
      return Array.from(store.sets.get(key) ?? []);
    },
    async lmove(src: string, dst: string, _from: 'RIGHT' | 'LEFT', _to: 'RIGHT' | 'LEFT') {
      const source = store.lists.get(src) ?? [];
      if (source.length === 0) return null;
      const value = source.pop() ?? null;
      if (value === null) return null;
      const target = store.lists.get(dst) ?? [];
      target.unshift(value);
      store.lists.set(src, source);
      store.lists.set(dst, target);
      return value;
    },
    async lpush(key: string, ...values: string[]) {
      const list = store.lists.get(key) ?? [];
      for (const v of values) list.unshift(v);
      store.lists.set(key, list);
      return list.length;
    },
    async del(key: string) {
      return store.lists.delete(key) ? 1 : 0;
    },
    async exists(key: string) {
      return store.lists.has(key) ? 1 : 0;
    },
    async srem(key: string, value: string) {
      const set = store.sets.get(key);
      if (!set) return 0;
      const before = set.size;
      set.delete(value);
      return before - set.size;
    },
    async sadd(key: string, value: string) {
      const set = store.sets.get(key) ?? new Set<string>();
      set.add(value);
      store.sets.set(key, set);
      return 1;
    },
  } as unknown as Redis;
  return { store, instance };
}

function makeBatcher(overrides?: {
  send?: MailProvider['send'];
  user?: { email: string; displayName: string; emailVerifiedAt: Date | null } | null;
}) {
  const { store, instance } = fakeRedis();
  const send = overrides?.send ?? vi.fn().mockResolvedValue({ jobId: 'job-1' });
  const findUnique = vi
    .fn()
    .mockResolvedValue(
      overrides?.user === undefined
        ? { email: 'user@example.com', displayName: 'Ana', emailVerifiedAt: new Date() }
        : overrides.user,
    );
  const prisma = {
    forSystem: () => ({ user: { findUnique } }),
  } as unknown as PrismaService;
  const config = {
    get: (key: string, fallback: unknown) => {
      if (key === 'NOTIF_EMAIL_BATCH_WINDOW_S') return 300;
      if (key === 'APP_BASE_URL') return 'https://tasker.dev';
      if (key === 'CLEANUP_REGISTER_TIMEOUT_MS') return 2000;
      return fallback;
    },
  } as unknown as ConfigService;
  const factory = { create: () => instance } as unknown as RedisConnectionFactory;
  const mail = { send } as unknown as MailProvider;
  const queue = { add: vi.fn().mockResolvedValue({ id: 'j' }) } as unknown as Queue;
  const batcher = new EmailBatcher(config, factory, mail, prisma, queue);
  return { batcher, store, send, findUnique };
}

function pushItem(store: FakeRedis, recipient: string, item: BufferedEmailItem) {
  const key = emailBucketKey(recipient);
  const list = store.lists.get(key) ?? [];
  list.unshift(JSON.stringify(item));
  store.lists.set(key, list);
  const set = store.sets.get(emailBucketIndexKey) ?? new Set<string>();
  set.add(recipient);
  store.sets.set(emailBucketIndexKey, set);
}

function makeItem(overrides?: Partial<BufferedEmailItem>): BufferedEmailItem {
  return {
    notificationId: 'n-1',
    workspaceId: 'ws-1',
    eventType: 'COMMENT_MENTION',
    sourceKind: 'COMMENT',
    sourceId: 'c-1',
    idempotencyKey: 'COMMENT_MENTION:user-a:c-1',
    payload: { actorDisplayName: 'Bruno', taskTitle: 'Ship it', projectName: 'Web' },
    bufferedAt: '2026-07-27T12:00:00Z',
    ...overrides,
  };
}

describe('EmailBatcher.drain', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches a single-item email with the per-event template', async () => {
    const { batcher, store, send } = makeBatcher();
    pushItem(store, 'user-a', makeItem());

    const result = await batcher.drain('user-a');

    expect(result.flushed).toBe(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'notification-mention',
        to: 'user@example.com',
        idempotencyKey: 'email:COMMENT_MENTION:user-a:c-1',
      }),
    );
  });

  it('dispatches a batch email when multiple items are pending', async () => {
    const { batcher, store, send } = makeBatcher();
    pushItem(store, 'user-a', makeItem({ idempotencyKey: 'k-1' }));
    pushItem(store, 'user-a', makeItem({ idempotencyKey: 'k-2', eventType: 'TASK_ASSIGNED' }));
    pushItem(store, 'user-a', makeItem({ idempotencyKey: 'k-3', eventType: 'SPRINT_LIFECYCLE' }));

    const result = await batcher.drain('user-a');

    expect(result.flushed).toBe(3);
    const call = vi.mocked(send).mock.calls[0]![0];
    expect(call.template).toBe('notification-batch');
    expect((call.variables as { count: number }).count).toBe(3);
  });

  it('scans every bucket in the index when no recipient is specified', async () => {
    const { batcher, store, send } = makeBatcher();
    pushItem(store, 'user-a', makeItem());
    pushItem(store, 'user-b', makeItem({ notificationId: 'n-b' }));

    const result = await batcher.drain();

    expect(result.flushed).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('skips recipients without a verified email but still drains their bucket', async () => {
    const { batcher, store, send } = makeBatcher({
      user: { email: 'x@example.com', displayName: 'X', emailVerifiedAt: null },
    });
    pushItem(store, 'user-a', makeItem());

    const result = await batcher.drain('user-a');
    expect(result.flushed).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('restores items to the source bucket when the mail dispatch fails', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('smtp down'));
    const { batcher, store } = makeBatcher({ send });
    pushItem(store, 'user-a', makeItem({ idempotencyKey: 'k-1' }));
    pushItem(store, 'user-a', makeItem({ idempotencyKey: 'k-2' }));

    await expect(batcher.drain('user-a')).rejects.toThrow(/smtp down/);
    const restored = store.lists.get(emailBucketKey('user-a'));
    expect(restored).toHaveLength(2);
  });
});
