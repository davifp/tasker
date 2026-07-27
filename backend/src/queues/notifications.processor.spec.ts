import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { NotificationJob } from '@tasker/config';
import { NotificationsProcessor } from './notifications.processor';

function makeJob(data: unknown): Job<NotificationJob> {
  return {
    id: 'job-1',
    name: (data as { type?: string })?.type ?? 'unknown',
    data: data as NotificationJob,
  } as Job<NotificationJob>;
}

describe('NotificationsProcessor', () => {
  it('handles the legacy comment.mention variant without throwing', async () => {
    const processor = new NotificationsProcessor();
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);
    await processor.process(
      makeJob({
        type: 'comment.mention',
        workspaceId: 'ws-1',
        commentId: 'c-1',
        taskId: 't-1',
        mentionedUserId: 'u-1',
        actorUserId: 'actor-1',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'comment.mention' }),
      'notifications.enqueued',
    );
  });

  it('logs receipt of the fan-out orchestrator variant', async () => {
    const processor = new NotificationsProcessor();
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);
    await processor.process(
      makeJob({
        type: 'notification.fanout',
        workspaceId: 'ws-1',
        eventType: 'COMMENT_MENTION',
        recipientUserId: 'user-a',
        notificationId: 'n-1',
        sourceKind: 'COMMENT',
        sourceId: 'c-1',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notification.fanout', recipientUserId: 'user-a' }),
      'notifications.fanout.received',
    );
  });

  it('logs receipt of email-batch and push variants', async () => {
    const processor = new NotificationsProcessor();
    const logSpy = vi.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);
    await processor.process(
      makeJob({ type: 'notification.email-batch', recipientUserId: 'user-a' }),
    );
    await processor.process(
      makeJob({
        type: 'notification.push',
        workspaceId: 'ws-1',
        recipientUserId: 'user-a',
        notificationId: 'n-1',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notification.email-batch' }),
      'notifications.email_batch.received',
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notification.push' }),
      'notifications.push.received',
    );
  });

  it('drops malformed jobs without throwing', async () => {
    const processor = new NotificationsProcessor();
    const warnSpy = vi.spyOn(processor['logger'], 'warn').mockImplementation(() => undefined);
    await processor.process(makeJob({ type: 'nonsense', workspaceId: 'ws-1' }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      'notifications.job.malformed',
    );
  });
});
