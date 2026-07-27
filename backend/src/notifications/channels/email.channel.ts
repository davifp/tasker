import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { NotificationEventType, NotificationSourceKind } from '@prisma/client';
import { RedisConnectionFactory } from '../../common/redis/redis-connection.factory';

// One serialised entry per buffered notification. Kept small on purpose so
// the bucket list can hold ten of these without blowing Redis memory.
// Rendering-time metadata (project name, task title, excerpt) is denormalised
// into `payload` by the caller so the batch drain never has to re-hit
// Postgres per item.
export interface BufferedEmailItem {
  notificationId: string;
  workspaceId: string;
  eventType: NotificationEventType;
  sourceKind: NotificationSourceKind;
  sourceId: string;
  actorUserId?: string;
  // Idempotency key from the fanout job. Two drains cannot dispatch two
  // emails for the same key because the mail queue's `jobId` collides.
  idempotencyKey: string;
  payload: Record<string, unknown>;
  bufferedAt: string; // ISO
}

const EMAIL_BUCKET_PREFIX = 'nfy:email:';
const EMAIL_BUCKET_INDEX_KEY = 'nfy:email:index';
const MAX_BUCKET_SIZE = 200;

export function emailBucketKey(recipientUserId: string): string {
  return `${EMAIL_BUCKET_PREFIX}${recipientUserId}`;
}

// The scanner keys off `nfy:email:index` — a Redis set of every recipient
// with pending items. Cheaper than KEYS/SCAN over the whole bucket
// namespace when many workspaces run concurrently.
export const emailBucketIndexKey = EMAIL_BUCKET_INDEX_KEY;

@Injectable()
export class EmailChannel {
  private readonly logger = new Logger(EmailChannel.name);
  private readonly redis: Redis;
  private readonly bucketTtlSeconds: number;

  constructor(config: ConfigService, factory: RedisConnectionFactory) {
    this.redis = factory.create();
    // Bucket auto-expiry is 2x the batch window so a batcher outage does
    // not silently discard items sooner than a human operator can notice.
    const batchWindow = config.get<number>('NOTIF_EMAIL_BATCH_WINDOW_S', 300);
    this.bucketTtlSeconds = batchWindow * 2;
  }

  // Buffer a single item onto the recipient's bucket. The recipient id is
  // added to the global index so the batcher can enumerate active buckets
  // without KEYS scans. Bucket length is capped — extra items are dropped
  // with a warn instead of unbounded growth (safety valve for a stuck
  // batcher).
  async buffer(recipientUserId: string, item: BufferedEmailItem): Promise<void> {
    const key = emailBucketKey(recipientUserId);
    const serialised = JSON.stringify(item);
    const [length] = await Promise.all([
      this.redis.lpush(key, serialised),
      this.redis.sadd(EMAIL_BUCKET_INDEX_KEY, recipientUserId),
      this.redis.expire(key, this.bucketTtlSeconds),
    ]);
    if (length > MAX_BUCKET_SIZE) {
      // Trim from the tail so the newest MAX_BUCKET_SIZE remain — matches
      // list semantics elsewhere in the app (bell dropdown truncates old).
      await this.redis.ltrim(key, 0, MAX_BUCKET_SIZE - 1);
      this.logger.warn(
        { recipientUserId, length },
        'email.bucket.overflow — trimmed to MAX_BUCKET_SIZE',
      );
    }
  }
}
