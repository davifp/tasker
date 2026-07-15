import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthCheckError } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';
import type Redis from 'ioredis';

function makeRedis(pingResult: Promise<string>): Redis {
  return { ping: vi.fn().mockReturnValue(pingResult) } as unknown as Redis;
}

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;

  beforeEach(() => {
    indicator = new RedisHealthIndicator(makeRedis(Promise.resolve('PONG')));
  });

  it('resolves on successful PING', async () => {
    const result = await indicator.isHealthy('redis');
    expect(result['redis']?.status).toBe('up');
  });

  it('throws HealthCheckError on PING failure', async () => {
    const failingRedis = makeRedis(Promise.reject(new Error('Connection refused')));
    const failingIndicator = new RedisHealthIndicator(failingRedis);

    await expect(failingIndicator.isHealthy('redis')).rejects.toThrow(HealthCheckError);
  });

  it('throws HealthCheckError on unexpected PING response', async () => {
    const weirdRedis = makeRedis(Promise.resolve('WRONG'));
    const weirdIndicator = new RedisHealthIndicator(weirdRedis);

    await expect(weirdIndicator.isHealthy('redis')).rejects.toThrow(HealthCheckError);
  });
});
