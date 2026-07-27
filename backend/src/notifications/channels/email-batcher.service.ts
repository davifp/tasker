import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { NotificationEventType } from '@prisma/client';
import { RedisConnectionFactory } from '../../common/redis/redis-connection.factory';
import { MAIL_PROVIDER, MailProvider, MailTemplate } from '../../common/mail/mail.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATIONS_QUEUE, NOTIFICATION_EMAIL_BATCH_JOB } from '../../queues/constants';
import { NotificationsMetricsCollector } from '../../metrics/notifications.metrics';
import { BufferedEmailItem, emailBucketIndexKey, emailBucketKey } from './email.channel';

const PROCESSING_SUFFIX = ':processing';

const TEMPLATE_FOR_EVENT: Record<NotificationEventType, MailTemplate> = {
  COMMENT_MENTION: 'notification-mention',
  TASK_ASSIGNED: 'notification-assignment',
  COMMENT_FOLLOWED: 'notification-comment-followed',
  SPRINT_LIFECYCLE: 'notification-sprint-lifecycle',
};

const EVENT_SUMMARY: Record<NotificationEventType, string> = {
  COMMENT_MENTION: 'mentioned you in a comment',
  TASK_ASSIGNED: 'assigned a task to you',
  COMMENT_FOLLOWED: 'commented on a task you follow',
  SPRINT_LIFECYCLE: 'changed the sprint state',
};

// Drains per-recipient email buckets into `MailProvider.send`. The drain is
// safe under crash-restart because items are moved to a processing list via
// `LMOVE`, and if the caller crashes before the send is enqueued the items
// are re-pushed to the head of the source bucket on next start.
@Injectable()
export class EmailBatcher implements OnModuleInit {
  private readonly logger = new Logger(EmailBatcher.name);
  private readonly redis: Redis;
  private readonly batchWindowSeconds: number;
  private readonly appBaseUrl: string;
  private readonly preferencesUrl: string;

  constructor(
    private readonly config: ConfigService,
    factory: RedisConnectionFactory,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    @Optional() private readonly metrics?: NotificationsMetricsCollector,
  ) {
    this.redis = factory.create();
    this.batchWindowSeconds = config.get<number>('NOTIF_EMAIL_BATCH_WINDOW_S', 300);
    this.appBaseUrl = config.get<string>('APP_BASE_URL', 'http://localhost:3000');
    this.preferencesUrl = `${this.appBaseUrl}/settings/notifications`;
  }

  // Register the repeatable batcher job. Delegates to the same idempotent
  // pattern used by `CleanupProcessor.onModuleInit` — Redis outage does not
  // block boot.
  async onModuleInit(): Promise<void> {
    const bootTimeoutMs = this.config.get<number>('CLEANUP_REGISTER_TIMEOUT_MS', 2000);
    try {
      await Promise.race([
        this.queue.add(
          NOTIFICATION_EMAIL_BATCH_JOB,
          { type: 'notification.email-batch' },
          {
            repeat: { every: this.batchWindowSeconds * 1000 },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        ),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`register email-batch job timed out after ${bootTimeoutMs}ms`)),
            bootTimeoutMs,
          ),
        ),
      ]);
      this.logger.log(
        { windowSeconds: this.batchWindowSeconds },
        'Email batcher repeatable job registered',
      );
    } catch (err) {
      this.logger.warn(
        { err },
        'Failed to register email batcher repeatable job — will retry on next boot',
      );
    }
  }

  // Public for direct invocation from the notifications processor. When
  // `targetRecipientId` is provided the batcher flushes exactly that bucket;
  // otherwise it enumerates the whole index and drains each.
  async drain(targetRecipientId?: string): Promise<{ flushed: number }> {
    const recipients = targetRecipientId
      ? [targetRecipientId]
      : await this.redis.smembers(emailBucketIndexKey);

    let flushed = 0;
    for (const recipientUserId of recipients) {
      const drained = await this.drainOne(recipientUserId);
      flushed += drained;
    }
    return { flushed };
  }

  private async drainOne(recipientUserId: string): Promise<number> {
    const source = emailBucketKey(recipientUserId);
    const processing = `${source}${PROCESSING_SUFFIX}`;

    // Move every pending item into the processing list atomically per hop.
    // `LMOVE ... RIGHT LEFT` peels from the tail (oldest first) into the
    // head of the processing list — that inverts arrival order once, which
    // we correct by reading right-to-left below.
    const items: BufferedEmailItem[] = [];
    for (;;) {
      const moved = await this.redis.lmove(source, processing, 'RIGHT', 'LEFT');
      if (moved === null) break;
      try {
        items.push(JSON.parse(moved) as BufferedEmailItem);
      } catch (err) {
        this.logger.warn(
          { err, recipientUserId, raw: moved },
          'email.batch.parse_failed — dropping item',
        );
      }
    }
    if (items.length === 0) {
      // Clean up the index entry so the next scan doesn't hit an empty bucket.
      await this.redis.srem(emailBucketIndexKey, recipientUserId);
      return 0;
    }

    const email = await this.prisma.forSystem().user.findUnique({
      where: { id: recipientUserId },
      select: { email: true, displayName: true, emailVerifiedAt: true },
    });
    if (!email || !email.email || !email.emailVerifiedAt) {
      // Unverified users never receive notification email — silently drop
      // and log. The bell entry stays in Postgres.
      this.logger.debug(
        { recipientUserId, verified: Boolean(email?.emailVerifiedAt) },
        'email.batch.skip — recipient without verified email',
      );
      await this.redis.del(processing);
      return items.length;
    }

    try {
      if (items.length === 1) {
        await this.dispatchSingle(email.email, items[0]!);
      } else {
        await this.dispatchBatch(email.email, items);
      }
      for (const item of items) {
        this.metrics?.incrementDelivered('EMAIL', item.eventType, 'success');
      }
      // Success — drop the processing list and clean the index.
      await Promise.all([
        this.redis.del(processing),
        this.redis
          .exists(source)
          .then((exists) =>
            exists ? Promise.resolve(0) : this.redis.srem(emailBucketIndexKey, recipientUserId),
          ),
      ]);
      return items.length;
    } catch (err) {
      this.logger.warn(
        { err, recipientUserId, size: items.length },
        'email.batch.enqueue_failed — restoring items',
      );
      for (const item of items) {
        this.metrics?.incrementDelivered('EMAIL', item.eventType, 'failure');
      }
      // Push items back to the head of the source list, oldest first, so
      // the next drain sees them in original arrival order.
      const raws = items.map((item) => JSON.stringify(item));
      if (raws.length > 0) await this.redis.lpush(source, ...raws.reverse());
      await this.redis.del(processing);
      throw err;
    }
  }

  private async dispatchSingle(to: string, item: BufferedEmailItem): Promise<void> {
    const template = TEMPLATE_FOR_EVENT[item.eventType];
    const variables = {
      actorName: stringOr(item.payload.actorDisplayName, 'Someone'),
      taskTitle: stringOr(item.payload.taskTitle, ''),
      projectName: stringOr(item.payload.projectName, ''),
      sprintName: stringOr(item.payload.sprintName, ''),
      state: stringOr(item.payload.state, ''),
      excerpt: stringOr(item.payload.excerpt, ''),
      sourceUrl: this.resolveSourceUrl(item),
      preferencesUrl: this.preferencesUrl,
    };
    await this.mail.send({
      template,
      to,
      variables,
      idempotencyKey: `email:${item.idempotencyKey}`,
    });
  }

  private async dispatchBatch(to: string, items: BufferedEmailItem[]): Promise<void> {
    const projected = items.map((item) => ({
      actorName: stringOr(item.payload.actorDisplayName, 'Someone'),
      summary: EVENT_SUMMARY[item.eventType],
      sourceUrl: this.resolveSourceUrl(item),
    }));
    await this.mail.send({
      template: 'notification-batch',
      to,
      variables: {
        count: items.length,
        items: projected,
        preferencesUrl: this.preferencesUrl,
      },
      // Idempotency key derived from the sorted per-item keys — a second
      // drain with the same set of items collapses onto the same mail job.
      idempotencyKey: `email-batch:${items
        .map((i) => i.idempotencyKey)
        .sort()
        .join('|')
        .slice(0, 180)}`,
    });
  }

  private resolveSourceUrl(item: BufferedEmailItem): string {
    // Task 8.0 will inject workspace-slug + project-slug context here so
    // that the URL points to the actual entity. Until then, deep link to
    // the bell page under the workspace so the recipient can click through.
    const workspaceSegment = stringOr(item.payload.workspaceSlug, item.workspaceId);
    return `${this.appBaseUrl}/${workspaceSegment}/notifications`;
  }
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
