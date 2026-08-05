import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { withJobTelemetry } from '../../observability/bullmq-tracing';
import { MAIL_QUEUE } from '../../queues/constants';
import { MailProvider, MailSendInput } from './mail.provider';

@Injectable()
export class QueuedMailAdapter implements MailProvider {
  private readonly logger = new Logger(QueuedMailAdapter.name);

  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue) {}

  async send(input: MailSendInput): Promise<{ jobId: string }> {
    const job = await this.queue.add(
      'send',
      withJobTelemetry(input as unknown as Record<string, unknown>),
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: false,
        ...(input.idempotencyKey ? { jobId: input.idempotencyKey } : {}),
      },
    );

    this.logger.log({ jobId: job.id, template: input.template, to: input.to }, 'Mail job enqueued');
    return { jobId: job.id! };
  }
}
