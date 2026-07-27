import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

// Shared parser for REDIS_URL so BullMQ, the throttler storage, the ticket
// service and the Socket.IO Redis adapter all speak to Redis with the same
// credentials. Each caller owns its own Redis instance — BullMQ requires
// `maxRetriesPerRequest: null`, the adapter requires distinct pub/sub
// connections, and the throttler is happy with the default.
@Injectable()
export class RedisConnectionFactory {
  constructor(private readonly config: ConfigService) {}

  parseUrl(): { host: string; port: number; password?: string } {
    const url = new URL(this.config.getOrThrow<string>('REDIS_URL'));
    const parsed: { host: string; port: number; password?: string } = {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
    };
    if (url.password) {
      parsed.password = decodeURIComponent(url.password);
    }
    return parsed;
  }

  // Options shape BullMQ requires — no per-request retry, no ready check.
  bullOptions(): RedisOptions {
    return { ...this.parseUrl(), maxRetriesPerRequest: null, enableReadyCheck: false };
  }

  // Default connection for one-shot commands (SETNX for the ticket jti store,
  // LMOVE for the email batcher). Lazy so tests that don't touch Redis don't
  // open a socket at boot.
  create(overrides: RedisOptions = {}): Redis {
    return new Redis({ ...this.parseUrl(), lazyConnect: true, ...overrides });
  }

  // Duplicated pub/sub pair for the Socket.IO Redis adapter. The adapter
  // requires two distinct connections; sharing one deadlocks under load.
  createPubSubPair(): { pub: Redis; sub: Redis } {
    const pub = this.create();
    const sub = pub.duplicate();
    return { pub, sub };
  }
}
