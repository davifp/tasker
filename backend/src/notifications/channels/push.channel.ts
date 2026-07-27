import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webPush, { WebPushError } from 'web-push';
import { PushSubscriptionsService } from '../../push/push-subscriptions.service';
import type { BufferedEmailItem } from './email.channel';

const EVENT_TITLE: Record<string, string> = {
  COMMENT_MENTION: 'You were mentioned',
  TASK_ASSIGNED: 'You have a new task',
  COMMENT_FOLLOWED: 'New comment on a task you follow',
  SPRINT_LIFECYCLE: 'Sprint update',
};

// Fields excluded from the wire payload — the browser SW cannot enforce
// server-side auth, so we never trust it to hide fields. Anything not in
// this allowlist stays server-side.
export interface PushWirePayload {
  title: string;
  body: string;
  url: string;
  eventType: string;
  notificationId: string;
}

// Renders the wire payload safely from a buffered notification item. Kept
// pure so the contract test can assert allowlist-only fields without
// pulling in Prisma or web-push.
export function scrubPushPayload(
  item: Pick<BufferedEmailItem, 'eventType' | 'notificationId' | 'payload'>,
  sourceUrl: string,
): PushWirePayload {
  const actor =
    typeof item.payload.actorDisplayName === 'string' ? item.payload.actorDisplayName : 'Someone';
  const task = typeof item.payload.taskTitle === 'string' ? item.payload.taskTitle : '';
  const body = task ? `${actor} — ${task}` : actor;
  return {
    title: EVENT_TITLE[item.eventType] ?? 'Tasker',
    body,
    url: sourceUrl,
    eventType: item.eventType,
    notificationId: item.notificationId,
  };
}

@Injectable()
export class PushChannel {
  private readonly logger = new Logger(PushChannel.name);
  private readonly appBaseUrl: string;
  private readonly configured: boolean;

  constructor(
    config: ConfigService,
    private readonly subs: PushSubscriptionsService,
  ) {
    this.appBaseUrl = config.get<string>('APP_BASE_URL', 'http://localhost:3000');
    const publicKey = config.get<string | undefined>('VAPID_PUBLIC_KEY');
    const privateKey = config.get<string | undefined>('VAPID_PRIVATE_KEY');
    const subject = config.get<string>('VAPID_SUBJECT', 'mailto:noreply@tasker.dev');
    this.configured = Boolean(publicKey && privateKey);
    if (this.configured) {
      webPush.setVapidDetails(subject, publicKey!, privateKey!);
    }
  }

  // Fans out one push per active subscription. On a permanent 404/410 the
  // row is deleted (endpoint gone) — that path is the sole responsibility
  // of the subscription table lifecycle. Transient failures (5xx) log and
  // continue; the next fan-out for that recipient will retry.
  async send(recipientUserId: string, item: BufferedEmailItem): Promise<{ delivered: number }> {
    if (!this.configured) {
      this.logger.debug({ recipientUserId }, 'push.disabled — VAPID keys missing');
      return { delivered: 0 };
    }
    const rows = await this.subs.listForUser(recipientUserId);
    if (rows.length === 0) return { delivered: 0 };
    const payload = scrubPushPayload(item, this.resolveSourceUrl(item));
    const serialised = JSON.stringify(payload);

    let delivered = 0;
    await Promise.all(
      rows.map(async (row) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: row.endpoint,
              keys: { p256dh: row.p256dh, auth: row.authKey },
            },
            serialised,
          );
          delivered++;
          await this.subs.touchLastSeen(row.id);
        } catch (err) {
          await this.classifyError(err, row.endpoint);
        }
      }),
    );
    return { delivered };
  }

  private async classifyError(err: unknown, endpoint: string): Promise<void> {
    if (err instanceof WebPushError) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Endpoint gone — remove the row so the next fan-out does not
        // waste an outbound request.
        await this.subs.deleteByEndpoint(endpoint);
        this.logger.log({ endpoint, statusCode: err.statusCode }, 'push.subscription.reaped');
        return;
      }
      this.logger.warn({ statusCode: err.statusCode, endpoint }, 'push.send.failed — transient');
      return;
    }
    this.logger.warn({ err, endpoint }, 'push.send.failed — unknown');
  }

  private resolveSourceUrl(item: BufferedEmailItem): string {
    const workspaceSegment =
      typeof item.payload.workspaceSlug === 'string' && item.payload.workspaceSlug.length > 0
        ? item.payload.workspaceSlug
        : item.workspaceId;
    return `${this.appBaseUrl}/${workspaceSegment}/notifications`;
  }
}
