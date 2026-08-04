import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// One minute expressed in milliseconds — the refill window we normalise to.
export const WINDOW_MS = 60_000;
const REDIS_KEY_PREFIX = 'platform:ratelimit:';
// The Redis hash TTL is a safety net for buckets that go idle; anything past
// this window is fully refilled anyway, so evicting them costs nothing.
const KEY_TTL_S = 3600;

export interface ConsumeInput {
  bucketId: string;
  cost?: number;
  /** Overrides for tests; production reads from ConfigService. */
  limit?: number;
  burst?: number;
}

export interface ConsumeResult {
  allowed: boolean;
  /** Tokens left in the bucket after this consume attempt. */
  remaining: number;
  /**
   * Absolute epoch-ms at which the bucket is expected to reach its full
   * capacity. Callers translate this to a `Retry-After` header when blocked.
   */
  resetAtMs: number;
  /** The configured sustained-rate ceiling per minute (X-RateLimit-Limit). */
  limit: number;
}

// Lua script — computes refill based on elapsed time, decrements atomically,
// returns the updated state. Runs as a single Redis command so racing calls
// cannot undercount.
//
// KEYS[1] = bucket key
// ARGV[1] = capacity (limit + burst)   ARGV[2] = per-ms refill rate
// ARGV[3] = cost                       ARGV[4] = nowMs
// ARGV[5] = ttl seconds                ARGV[6] = limit (sustained rate)
//
// Returns: {allowed, remainingInt, remainingMillis, resetAtMs}
const LUA_CONSUME = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local nowMs = tonumber(ARGV[4])
local ttlS = tonumber(ARGV[5])
local sustained = tonumber(ARGV[6])

local state = redis.call('HMGET', key, 'tokensMilli', 'updatedAt')
local tokensMilli = tonumber(state[1])
local updatedAt = tonumber(state[2])

if tokensMilli == nil or updatedAt == nil then
  tokensMilli = capacity * 1000
  updatedAt = nowMs
end

local elapsed = math.max(0, nowMs - updatedAt)
local refill = elapsed * refillPerMs * 1000
tokensMilli = math.min(capacity * 1000, tokensMilli + refill)

local allowed = 0
if tokensMilli >= cost * 1000 then
  tokensMilli = tokensMilli - cost * 1000
  allowed = 1
end

redis.call('HMSET', key, 'tokensMilli', tokensMilli, 'updatedAt', nowMs)
redis.call('EXPIRE', key, ttlS)

local remainingInt = math.floor(tokensMilli / 1000)
-- Time to refill back to sustained ceiling: (deficit / rate) — used for
-- the X-RateLimit-Reset absolute epoch header.
local deficitMilli = math.max(0, sustained * 1000 - tokensMilli)
local msUntilReset = 0
if refillPerMs > 0 then
  msUntilReset = math.ceil(deficitMilli / (refillPerMs * 1000))
end
local resetAtMs = nowMs + msUntilReset

return { allowed, remainingInt, resetAtMs }
`;

/**
 * Redis-backed token bucket. One bucket per API key. Sustained rate =
 * `RATE_LIMIT_DEFAULT_PER_MIN` per 60 s window, plus a small burst allowance
 * so quick spikes (a paginated backfill kicking off many parallel reads) do
 * not stutter under the sustained ceiling.
 */
@Injectable()
export class TokenBucketService {
  private readonly defaultLimitPerMin: number;
  private readonly defaultBurst: number;

  constructor(
    private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.defaultLimitPerMin = config.get<number>('RATE_LIMIT_DEFAULT_PER_MIN') ?? 1000;
    this.defaultBurst = config.get<number>('RATE_LIMIT_BURST') ?? 50;
  }

  async consume(input: ConsumeInput): Promise<ConsumeResult> {
    const limit = input.limit ?? this.defaultLimitPerMin;
    const burst = input.burst ?? this.defaultBurst;
    const capacity = limit + burst;
    const refillPerMs = limit / WINDOW_MS;
    const cost = input.cost ?? 1;
    const nowMs = Date.now();

    const key = `${REDIS_KEY_PREFIX}${input.bucketId}`;
    const raw = (await this.redis.eval(
      LUA_CONSUME,
      1,
      key,
      capacity.toString(),
      refillPerMs.toString(),
      cost.toString(),
      nowMs.toString(),
      KEY_TTL_S.toString(),
      limit.toString(),
    )) as [number, number, number];

    return {
      allowed: raw[0] === 1,
      remaining: raw[1],
      resetAtMs: raw[2],
      limit,
    };
  }
}
