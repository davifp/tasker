import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const redisKey = `throttle:${throttlerName}:${key}`;
    const hits = await this.redis.incr(redisKey);
    if (hits === 1) {
      await this.redis.pexpire(redisKey, ttl);
    }
    const pttl = await this.redis.pttl(redisKey);
    const timeToExpire = Math.max(0, Math.ceil(pttl / 1000));
    const isBlocked = hits > limit;
    return {
      totalHits: hits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockDuration / 1000) : 0,
    };
  }
}
