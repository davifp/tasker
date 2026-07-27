import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { NotificationJob } from '@tasker/config';
import type { PreferencesService } from './preferences.service';
import type { EmailChannel } from './channels/email.channel';
import type { EmailBatcher } from './channels/email-batcher.service';
import { NotificationsProcessor } from './notifications.processor';

function makeJob(data: unknown): Job<NotificationJob> {
  return {
    id: 'job-1',
    name: (data as { type?: string })?.type ?? 'unknown',
    data: data as NotificationJob,
  } as Job<NotificationJob>;
}

function makeProcessor(prefs?: { emailEnabled?: boolean }) {
  const isEnabled = vi.fn().mockResolvedValue(prefs?.emailEnabled ?? true);
  const buffer = vi.fn().mockResolvedValue(undefined);
  const drain = vi.fn().mockResolvedValue({ flushed: 3 });
  const preferences = { isEnabled } as unknown as PreferencesService;
  const email = { buffer } as unknown as EmailChannel;
  const batcher = { drain } as unknown as EmailBatcher;
  return {
    processor: new NotificationsProcessor(preferences, email, batcher),
    isEnabled,
    buffer,
    drain,
  };
}

describe('NotificationsProcessor', () => {
  it('handles the legacy comment.mention variant with a log only', async () => {
    const { processor } = makeProcessor();
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

  it('buffers the email channel on fan-out when EMAIL is enabled', async () => {
    const { processor, buffer, isEnabled } = makeProcessor({ emailEnabled: true });
    await processor.process(
      makeJob({
        type: 'notification.fanout',
        workspaceId: 'ws-1',
        eventType: 'COMMENT_MENTION',
        recipientUserId: 'user-a',
        notificationId: 'n-1',
        sourceKind: 'COMMENT',
        sourceId: 'c-1',
        payload: { actorDisplayName: 'Bruno' },
      }),
    );
    expect(isEnabled).toHaveBeenCalledWith('user-a', 'COMMENT_MENTION', 'EMAIL');
    expect(buffer).toHaveBeenCalledTimes(1);
    const [recipient, item] = buffer.mock.calls[0]!;
    expect(recipient).toBe('user-a');
    expect(item).toMatchObject({
      idempotencyKey: 'COMMENT_MENTION:user-a:c-1',
      payload: { actorDisplayName: 'Bruno' },
    });
  });

  it('does not buffer when EMAIL is disabled by preferences', async () => {
    const { processor, buffer } = makeProcessor({ emailEnabled: false });
    await processor.process(
      makeJob({
        type: 'notification.fanout',
        workspaceId: 'ws-1',
        eventType: 'COMMENT_MENTION',
        recipientUserId: 'user-a',
        notificationId: 'n-1',
        sourceKind: 'COMMENT',
        sourceId: 'c-1',
        payload: {},
      }),
    );
    expect(buffer).not.toHaveBeenCalled();
  });

  it('drains the email batcher on the repeatable notification.email-batch job', async () => {
    const { processor, drain } = makeProcessor();
    await processor.process(makeJob({ type: 'notification.email-batch' }));
    expect(drain).toHaveBeenCalledWith(undefined);
  });

  it('drops malformed jobs without throwing', async () => {
    const { processor } = makeProcessor();
    const warnSpy = vi.spyOn(processor['logger'], 'warn').mockImplementation(() => undefined);
    await processor.process(makeJob({ type: 'nonsense', workspaceId: 'ws-1' }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      'notifications.job.malformed',
    );
  });
});
