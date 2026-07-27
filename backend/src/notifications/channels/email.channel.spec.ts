import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { RedisConnectionFactory } from '../../common/redis/redis-connection.factory';
import {
  EmailChannel,
  emailBucketIndexKey,
  emailBucketKey,
  type BufferedEmailItem,
} from './email.channel';

interface FakeRedis {
  lists: Map<string, string[]>;
  sets: Map<string, Set<string>>;
  expires: Map<string, number>;
  ltrimCalls: Array<[string, number, number]>;
}

function fakeRedis(): { store: FakeRedis; instance: Redis } {
  const store: FakeRedis = {
    lists: new Map(),
    sets: new Map(),
    expires: new Map(),
    ltrimCalls: [],
  };
  const instance = {
    async lpush(key: string, value: string) {
      const list = store.lists.get(key) ?? [];
      list.unshift(value);
      store.lists.set(key, list);
      return list.length;
    },
    async sadd(key: string, value: string) {
      const set = store.sets.get(key) ?? new Set<string>();
      const before = set.size;
      set.add(value);
      store.sets.set(key, set);
      return set.size - before;
    },
    async expire(key: string, ttl: number) {
      store.expires.set(key, ttl);
      return 1;
    },
    async ltrim(key: string, start: number, stop: number) {
      store.ltrimCalls.push([key, start, stop]);
      const list = store.lists.get(key) ?? [];
      store.lists.set(key, list.slice(start, stop + 1));
      return 'OK';
    },
  } as unknown as Redis;
  return { store, instance };
}

function makeChannel(overrides?: { batchWindow?: number }) {
  const { store, instance } = fakeRedis();
  const config = {
    get: (key: string, fallback: unknown) =>
      key === 'NOTIF_EMAIL_BATCH_WINDOW_S' ? (overrides?.batchWindow ?? 300) : fallback,
  } as unknown as ConfigService;
  const factory = { create: () => instance } as unknown as RedisConnectionFactory;
  return { channel: new EmailChannel(config, factory), store };
}

function makeItem(overrides?: Partial<BufferedEmailItem>): BufferedEmailItem {
  return {
    notificationId: 'n-1',
    workspaceId: 'ws-1',
    eventType: 'COMMENT_MENTION',
    sourceKind: 'COMMENT',
    sourceId: 'c-1',
    idempotencyKey: 'COMMENT_MENTION:user-a:c-1',
    payload: {},
    bufferedAt: '2026-07-27T12:00:00Z',
    ...overrides,
  };
}

describe('EmailChannel.buffer', () => {
  it('LPUSHes the serialised item and adds the recipient to the index', async () => {
    const { channel, store } = makeChannel();
    await channel.buffer('user-a', makeItem());

    const bucket = store.lists.get(emailBucketKey('user-a'));
    expect(bucket).toHaveLength(1);
    expect(JSON.parse(bucket![0]!)).toMatchObject({ notificationId: 'n-1' });
    expect(store.sets.get(emailBucketIndexKey)?.has('user-a')).toBe(true);
  });

  it('sets a bucket TTL of 2x the batch window', async () => {
    const { channel, store } = makeChannel({ batchWindow: 300 });
    await channel.buffer('user-a', makeItem());
    expect(store.expires.get(emailBucketKey('user-a'))).toBe(600);
  });

  it('trims the bucket to MAX_BUCKET_SIZE when overflow is detected', async () => {
    const { channel, store } = makeChannel();
    for (let i = 0; i < 205; i++) {
      await channel.buffer('user-a', makeItem({ idempotencyKey: `k-${i}` }));
    }
    expect(store.ltrimCalls.length).toBeGreaterThan(0);
    const [key, start, stop] = store.ltrimCalls[0]!;
    expect(key).toBe(emailBucketKey('user-a'));
    expect(start).toBe(0);
    expect(stop).toBe(199);
  });
});
