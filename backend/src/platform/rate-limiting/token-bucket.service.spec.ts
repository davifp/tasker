import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { TokenBucketService } from './token-bucket.service';

function buildService(
  overrides: {
    eval?: ReturnType<typeof vi.fn>;
    limitPerMin?: number;
    burst?: number;
  } = {},
): { service: TokenBucketService; evalMock: ReturnType<typeof vi.fn> } {
  const evalMock = overrides.eval ?? vi.fn().mockResolvedValue([1, 42, Date.now() + 60_000]);
  const redis = { eval: evalMock } as unknown as Redis;
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'RATE_LIMIT_DEFAULT_PER_MIN') return overrides.limitPerMin ?? 1000;
      if (key === 'RATE_LIMIT_BURST') return overrides.burst ?? 50;
      return undefined;
    }),
  } as unknown as ConfigService;
  return { service: new TokenBucketService(redis, config), evalMock };
}

describe('TokenBucketService.consume', () => {
  it('returns allowed=true and the remaining count from Lua', async () => {
    const { service } = buildService({
      eval: vi.fn().mockResolvedValue([1, 999, Date.now() + 5_000]),
    });
    const result = await service.consume({ bucketId: 'api-key-1' });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(999);
    expect(result.limit).toBe(1000);
    expect(result.resetAtMs).toBeGreaterThan(Date.now());
  });

  it('returns allowed=false when Lua reports 0', async () => {
    const { service } = buildService({
      eval: vi.fn().mockResolvedValue([0, 0, Date.now() + 10_000]),
    });
    const result = await service.consume({ bucketId: 'api-key-2' });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('forwards custom limit + burst overrides into the Lua ARGV', async () => {
    const { service, evalMock } = buildService();
    await service.consume({ bucketId: 'api-key-3', limit: 500, burst: 100, cost: 2 });
    const argv = evalMock.mock.calls[0]?.slice(3);
    expect(argv).toBeDefined();
    // capacity = limit + burst
    expect(argv?.[0]).toBe('600');
    // refill rate per ms = limit / 60_000
    expect(Number(argv?.[1])).toBeCloseTo(500 / 60_000, 8);
    expect(argv?.[2]).toBe('2');
    // sustained limit — matches header value
    expect(argv?.[5]).toBe('500');
  });

  it('uses env-driven defaults when no override is provided', async () => {
    const { service, evalMock } = buildService({ limitPerMin: 200, burst: 20 });
    await service.consume({ bucketId: 'api-key-4' });
    const argv = evalMock.mock.calls[0]?.slice(3);
    expect(argv?.[0]).toBe('220');
    expect(argv?.[5]).toBe('200');
  });

  it('scopes the Redis key with a platform-specific prefix', async () => {
    const { service, evalMock } = buildService();
    await service.consume({ bucketId: 'abc' });
    const key = evalMock.mock.calls[0]?.[2];
    expect(key).toContain('platform:ratelimit:');
    expect(key).toContain('abc');
  });
});
