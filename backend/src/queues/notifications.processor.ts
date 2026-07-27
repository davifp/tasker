import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { notificationJobSchema, NotificationJob } from '@tasker/config';
import { NOTIFICATIONS_QUEUE } from './constants';

// Consumer for the notifications queue. The producer contract is frozen in
// `@tasker/config` as a discriminated union:
//   * `comment.mention`         — legacy Phase-5 fan-in (still emitted by
//     CommentsService). Task 8.0 replaces the producer with a
//     `notification.fanout` call so this branch can be retired.
//   * `notification.fanout`     — the orchestrator variant produced by
//     `NotificationsService.notify`. Task 6.0 and Task 7.0 will replace the
//     current noop with real email/push sub-job enqueues.
//   * `notification.email-batch`— scheduled every 5 min (or on-demand for
//     tests); flushes the per-recipient email buffer. Task 6.0.
//   * `notification.push`       — per-recipient push delivery. Task 7.0.
//
// Every branch validates through `notificationJobSchema` at the boundary so
// a producer drift fails loudly here instead of silently at a later swap.
@Injectable()
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

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
      case 'notification.fanout':
        // Task 6.0/7.0 will enqueue per-channel sub-jobs here. Until then, the
        // in-app channel has already been delivered synchronously inside
        // `NotificationsService.notify`, so this branch just logs.
        this.logger.log(
          {
            jobId: job.id,
            type: data.type,
            workspaceId: data.workspaceId,
            eventType: data.eventType,
            recipientUserId: data.recipientUserId,
          },
          'notifications.fanout.received',
        );
        return;
      case 'notification.email-batch':
        this.logger.log(
          { jobId: job.id, type: data.type, recipientUserId: data.recipientUserId ?? 'scan' },
          'notifications.email_batch.received',
        );
        return;
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
