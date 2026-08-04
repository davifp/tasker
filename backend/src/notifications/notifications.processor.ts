import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { notificationJobSchema, NotificationJob } from '@tasker/config';
import { NOTIFICATIONS_QUEUE } from '../queues/constants';
import { PreferencesService } from './preferences.service';
import { EmailChannel } from './channels/email.channel';
import { EmailBatcher } from './channels/email-batcher.service';
import { PushChannel } from './channels/push.channel';

// Consumer for the notifications queue. The producer contract is frozen in
// `@tasker/config` as a discriminated union:
//   * `comment.mention`         — legacy Phase-5 fan-in (still emitted by
//     CommentsService). Task 8.0 will replace the producer with a
//     `notification.fanout` call so this branch can be retired.
//   * `notification.fanout`     — the orchestrator variant produced by
//     `NotificationsService.notify`. Buffers per-channel work: EMAIL goes
//     into a Redis list, PUSH will be handled in Task 7.0.
//   * `notification.email-batch`— repeatable schedule (`NOTIF_EMAIL_BATCH_WINDOW_S`)
//     that drains every recipient bucket, or drains a specific bucket when
//     `recipientUserId` is set (used in tests).
//   * `notification.push`       — per-recipient push delivery. Task 7.0.
//
// Every branch validates through `notificationJobSchema` at the boundary so
// producer drift fails loudly here instead of silently at a later swap.
@Injectable()
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly preferences: PreferencesService,
    private readonly emailChannel: EmailChannel,
    private readonly emailBatcher: EmailBatcher,
    private readonly pushChannel: PushChannel,
  ) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    const parsed = notificationJobSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.warn(
        { jobId: job.id, name: job.name, issues: parsed.error.errors },
        'notifications.job.malformed',
      );
      return;
    }
    const data = parsed.data;
    switch (data.type) {
      case 'comment.mention':
        this.logger.log(
          {
            jobId: job.id,
            type: data.type,
            workspaceId: data.workspaceId,
            commentId: data.commentId,
            mentionedUserId: data.mentionedUserId,
            actorUserId: data.actorUserId,
          },
          'notifications.enqueued',
        );
        return;

      case 'notification.fanout': {
        // Re-check the preference matrix at fan-out time so a flip that
        // happens between `notify()` and the drain (rare, but possible under
        // a 5-min buffer) is honoured.
        const [emailEnabled, pushEnabled] = await Promise.all([
          this.preferences.isEnabled(data.recipientUserId, data.eventType, 'EMAIL'),
          this.preferences.isEnabled(data.recipientUserId, data.eventType, 'PUSH'),
        ]);
        const bufferedItem = {
          notificationId: data.notificationId,
          workspaceId: data.workspaceId,
          eventType: data.eventType,
          sourceKind: data.sourceKind,
          sourceId: data.sourceId,
          ...(data.actorUserId ? { actorUserId: data.actorUserId } : {}),
          idempotencyKey: `${data.eventType}-${data.recipientUserId}-${data.sourceId}`,
          payload: data.payload,
          bufferedAt: new Date().toISOString(),
        };
        if (emailEnabled) {
          await this.emailChannel.buffer(data.recipientUserId, bufferedItem);
        }
        let pushDelivered = 0;
        if (pushEnabled) {
          // Push delivery is synchronous per fan-out job — no buffer — because
          // the user just triggered an event and the browser can absorb the
          // notification immediately. The channel handles 404/410 cleanup
          // and swallows transient failures.
          const result = await this.pushChannel.send(data.recipientUserId, bufferedItem);
          pushDelivered = result.delivered;
        }
        this.logger.log(
          {
            jobId: job.id,
            recipientUserId: data.recipientUserId,
            eventType: data.eventType,
            emailEnabled,
            pushEnabled,
            pushDelivered,
          },
          'notifications.fanout.dispatched',
        );
        return;
      }

      case 'notification.email-batch': {
        const result = await this.emailBatcher.drain(data.recipientUserId);
        this.logger.log(
          { jobId: job.id, flushed: result.flushed },
          'notifications.email_batch.drained',
        );
        return;
      }

      case 'notification.push':
        this.logger.log(
          {
            jobId: job.id,
            type: data.type,
            workspaceId: data.workspaceId,
            recipientUserId: data.recipientUserId,
            notificationId: data.notificationId,
          },
          'notifications.push.received',
        );
        return;
    }
  }
}
