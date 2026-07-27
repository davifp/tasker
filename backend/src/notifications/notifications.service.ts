import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { NotificationEventType, NotificationSourceKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisConnectionFactory } from '../common/redis/redis-connection.factory';
import { NOTIFICATIONS_QUEUE, NOTIFICATION_FANOUT_JOB } from '../queues/constants';
import { PreferencesService } from './preferences.service';
import { InAppChannel } from './channels/in-app.channel';

const DEDUPE_KEY_PREFIX = 'nfy:dedupe:';

export interface NotifyInput {
  workspaceId: string;
  eventType: NotificationEventType;
  actorUserId?: string;
  recipients: string[];
  sourceEntity: { kind: NotificationSourceKind; id: string };
  payload: Record<string, unknown>;
}

// Single entry-point for domain code to raise a bell notification. Handles:
//   1. Dedupe per (recipient × eventType × sourceId) inside NOTIF_DEDUPE_WINDOW_S
//   2. Preference gate for IN_APP (skips row creation entirely if the user
//      has explicitly disabled the event type on every channel)
//   3. Immediate row + WS emit so the bell updates within the < 500 ms SLO
//   4. One fan-out job per recipient for email/push (handled by workers
//      shipped in Tasks 6.0 and 7.0)
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly dedupeWindowSeconds: number;
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: PreferencesService,
    @Inject(InAppChannel) private readonly inApp: InAppChannel,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    config: ConfigService,
    factory: RedisConnectionFactory,
  ) {
    this.dedupeWindowSeconds = config.get<number>('NOTIF_DEDUPE_WINDOW_S', 60);
    this.redis = factory.create();
  }

  async notify(input: NotifyInput): Promise<void> {
    // Actor never notifies themselves.
    const recipients = Array.from(
      new Set(input.recipients.filter((r) => r && r !== input.actorUserId)),
    );
    if (recipients.length === 0) return;

    for (const recipientUserId of recipients) {
      const dedupeKey = `${DEDUPE_KEY_PREFIX}${input.eventType}:${recipientUserId}:${input.sourceEntity.id}`;
      const stored = await this.redis.set(
        dedupeKey,
        '1',
        'PX',
        this.dedupeWindowSeconds * 1000,
        'NX',
      );
      if (stored !== 'OK') {
        this.logger.debug(
          { recipientUserId, eventType: input.eventType, sourceId: input.sourceEntity.id },
          'notifications.dedupe.skip',
        );
        continue;
      }

      const prefs = await this.preferences.getEffective(recipientUserId);
      const eventPrefs = prefs[input.eventType];
      if (!eventPrefs || (!eventPrefs.IN_APP && !eventPrefs.EMAIL && !eventPrefs.PUSH)) {
        // User has explicitly opted out of every channel for this event.
        continue;
      }

      let notificationId: string | null = null;
      if (eventPrefs.IN_APP) {
        const notification = await this.prisma.forSystem().notification.create({
          data: {
            workspaceId: input.workspaceId,
            recipientUserId,
            ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
            eventType: input.eventType,
            sourceKind: input.sourceEntity.kind,
            sourceId: input.sourceEntity.id,
            payload: input.payload as object,
          },
        });
        notificationId = notification.id;
        await this.inApp.deliver(notification);
      }

      // Fan-out for email / push runs on the queue so a slow SMTP or push
      // service never blocks the calling domain service.
      if (eventPrefs.EMAIL || eventPrefs.PUSH) {
        await this.queue.add(
          NOTIFICATION_FANOUT_JOB,
          {
            type: 'notification.fanout',
            workspaceId: input.workspaceId,
            eventType: input.eventType,
            recipientUserId,
            notificationId: notificationId ?? '',
            sourceKind: input.sourceEntity.kind,
            sourceId: input.sourceEntity.id,
            ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
          },
          {
            jobId: `fanout:${input.eventType}:${recipientUserId}:${input.sourceEntity.id}`,
            removeOnComplete: 500,
            removeOnFail: 100,
          },
        );
      }
    }
  }

  // Read side — used by the controller. All queries are scoped by
  // (recipientUserId, workspaceId) so switching workspaces on the client
  // resets the bell without leaking cross-workspace state.
  async list(
    recipientUserId: string,
    workspaceId: string,
    opts: { cursor?: string; limit: number; unreadOnly: boolean; type?: NotificationEventType },
  ) {
    const where = {
      recipientUserId,
      workspaceId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(opts.type ? { eventType: opts.type } : {}),
    };
    const rows = await this.prisma.forSystem().notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > opts.limit;
    const items = hasMore ? rows.slice(0, opts.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  }

  async unreadCount(recipientUserId: string, workspaceId: string): Promise<number> {
    return this.prisma
      .forSystem()
      .notification.count({ where: { recipientUserId, workspaceId, readAt: null } });
  }

  // Returns whether at least one row was updated so the controller can 404
  // when the id belongs to a different user or a different workspace.
  async markRead(id: string, recipientUserId: string, workspaceId: string): Promise<boolean> {
    const result = await this.prisma.forSystem().notification.updateMany({
      where: { id, recipientUserId, workspaceId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) return true;
    // Distinguish "already read" (still 204-worthy) from "not found".
    const exists = await this.prisma.forSystem().notification.findFirst({
      where: { id, recipientUserId, workspaceId },
      select: { id: true },
    });
    return Boolean(exists);
  }

  async markAllRead(recipientUserId: string, workspaceId: string): Promise<{ updated: number }> {
    const result = await this.prisma.forSystem().notification.updateMany({
      where: { recipientUserId, workspaceId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
