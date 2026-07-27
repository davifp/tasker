import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { notificationJobSchema, NotificationJob } from '@tasker/config';
import { NOTIFICATIONS_QUEUE } from './constants';

/**
 * Stub consumer for Phase 5. Phase 8 will replace the body with real
 * email/push/in-app delivery; the producer contract (payload shape) is
 * already frozen in `notificationJobSchema` so this swap is drop-in.
 *
 * Rejects malformed jobs at the boundary so a shape drift in a producer
 * fails loudly here, not silently at Phase 8 rollout.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  async process(job: Job<NotificationJob>): Promise<void> {
    const parsed = notificationJobSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.warn(
        { jobId: job.id, name: job.name, issues: parsed.error.errors },
        'Dropping malformed notification job',
      );
      return;
    }
    // Task 4.0 will replace this stub with per-type dispatch. Until then, log
    // only fields available on the specific variant so the union stays type-safe.
    const data = parsed.data;
    if (data.type === 'comment.mention') {
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
    }
    this.logger.log({ jobId: job.id, type: data.type }, 'notifications.enqueued');
  }
}
