import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { RealtimeTicketService } from './realtime.ticket.service';
import { RedisConnectionFactory } from '../common/redis/redis-connection.factory';

function fakeRedis(): Redis {
  const store = new Map<string, string>();
  return {
    async set(key: string, value: string, _px: 'PX', _ttl: number, _nx: 'NX') {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
  } as unknown as Redis;
}

function makeService(overrides?: {
  ttlSeconds?: number;
  secret?: string;
  redis?: Redis;
}): RealtimeTicketService {
  const ttl = overrides?.ttlSeconds ?? 60;
  const secret = overrides?.secret ?? 'rt-secret-that-is-at-least-32-chars-long';
  const config = {
    get: (key: string) => (key === 'RT_TICKET_TTL_S' ? ttl : secret),
  } as unknown as ConfigService;
  const jwt = new JwtService({ secret });
  const factory = {
    create: () => overrides?.redis ?? fakeRedis(),
  } as unknown as RedisConnectionFactory;
  return new RealtimeTicketService(config, jwt, factory);
}

describe('RealtimeTicketService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('mints a ticket redeemable exactly once', async () => {
    const service = makeService();
    const { ticket, expiresAt } = await service.mint('user-1');
    expect(ticket).toBeTypeOf('string');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const first = await service.verifyAndConsume(ticket);
    expect(first).toEqual({ userId: 'user-1' });
  });

  it('rejects a replayed ticket', async () => {
    const service = makeService();
    const { ticket } = await service.mint('user-1');
    await service.verifyAndConsume(ticket);
    await expect(service.verifyAndConsume(ticket)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a ticket signed with a different secret', async () => {
    const minter = makeService({ secret: 'other-secret-that-is-at-least-32-chars-long!!' });
    const verifier = makeService();
    const { ticket } = await minter.mint('user-1');
    await expect(verifier.verifyAndConsume(ticket)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a garbage ticket', async () => {
    const service = makeService();
    await expect(service.verifyAndConsume('not-a-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a ticket whose audience is not rt-ticket', async () => {
    const service = makeService();
    const jwt = new JwtService({ secret: 'rt-secret-that-is-at-least-32-chars-long' });
    const bad = jwt.sign({
      sub: 'user-1',
      jti: 'x',
      aud: 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(service.verifyAndConsume(bad)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired ticket', async () => {
    vi.useFakeTimers();
    const service = makeService({ ttlSeconds: 60 });
    const { ticket } = await service.mint('user-1');
    vi.setSystemTime(Date.now() + 61_000);
    await expect(service.verifyAndConsume(ticket)).rejects.toBeInstanceOf(UnauthorizedException);
    vi.useRealTimers();
  });
});
