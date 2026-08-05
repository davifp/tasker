import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { AuditEvent } from '../../common/audit/audit.events';
import { PrismaService } from '../../prisma/prisma.service';
import { WEBHOOK_DLQ_QUEUE } from '../../queues/constants';
import type { WebhookDlqJobData } from './webhook-delivery.types';

@Injectable()
@Processor(WEBHOOK_DLQ_QUEUE)
export class WebhookDlqProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDlqProcessor.name);
  private readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    super();
    this.retentionDays = config.get<number>('WEBHOOK_DELIVERY_RETENTION_DAYS', 30);
  }

  async process(job: Job<WebhookDlqJobData>): Promise<void> {
    const { webhookId, eventType, eventId, payload, lastAttemptAt, retryCount } = job.data;
    const expiresAt = new Date(Date.now() + this.retentionDays * 24 * 60 * 60 * 1000);
    try {
      await this.prisma.forSystem().webhookDeliveryDLQ.create({
        data: {
          webhookId,
          eventType,
          eventId,
          payload: payload as object,
          lastAttemptAt: new Date(lastAttemptAt),
          retryCount,
          expiresAt,
        },
      });
    } catch (err) {
      this.logger.error({ err, webhookId, eventId }, 'Failed to persist DLQ row');
      throw err;
    }

    // Fire an audit-style event that the AuditSubscriber picks up. The event
    // name matches the AuditEvent constant so no adapter is needed.
    this.events.emit(AuditEvent.WEBHOOK_DELIVERY_FAILED, {
      webhookId,
      eventType,
      eventId,
      retryCount,
    });
  }
}
