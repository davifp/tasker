import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { WEBHOOK_DELIVERY_QUEUE, WEBHOOK_DLQ_JOB, WEBHOOK_DLQ_QUEUE } from '../../queues/constants';
import { WebhookMetricsCollector } from './webhook.metrics';
import { WebhookSigner } from './webhook-signer';
import type { WebhookDeliveryJobData, WebhookDlqJobData } from './webhook-delivery.types';

// A response body larger than this is truncated before we persist it — the
// snippet is meant for a UI panel, not a full byte-mirror.
const RESPONSE_SNIPPET_MAX_BYTES = 1024;

@Injectable()
@Processor(WEBHOOK_DELIVERY_QUEUE)
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: WebhookSigner,
    private readonly metrics: WebhookMetricsCollector,
    private readonly config: ConfigService,
    @InjectQueue(WEBHOOK_DLQ_QUEUE) private readonly dlq: Queue,
  ) {
    super();
    this.timeoutMs = config.get<number>('WEBHOOK_HTTP_TIMEOUT_MS', 10_000);
  }

  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const { webhookId, eventType, eventId, payload } = job.data;
    const attempt = job.attemptsMade + 1;
    const startedAt = Date.now();

    const webhook = await this.prisma.forSystem().webhook.findUnique({ where: { id: webhookId } });
    if (!webhook || !webhook.isActive) {
      // Silently drop deliveries for deleted/deactivated subscribers; there is
      // no receiver to notify and the DLQ is meant for downstream failures,
      // not local admin choices.
      this.logger.log({ webhookId, eventId }, 'Skipping delivery — subscriber missing or inactive');
      throw new UnrecoverableError('webhook missing or inactive');
    }

    const rawBody = JSON.stringify({
      id: eventId,
      type: eventType,
      workspaceId: webhook.workspaceId,
      createdAt: new Date().toISOString(),
      data: payload,
    });

    let rawSecret: string;
    try {
      rawSecret = this.signer.decrypt(webhook.secretSalt, webhook.secretHash);
    } catch (err) {
      this.logger.error({ webhookId, err }, 'Failed to decrypt webhook secret — dropping delivery');
      throw new UnrecoverableError('secret decryption failed');
    }
    const signedHeader = this.signer.sign(rawBody, rawSecret);
    let statusCode: number | null = null;
    let responseSnippet: string | null = null;
    let error: string | null = null;
    let outcome: 'success' | 'retry' | 'dlq' = 'retry';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Tasker-Event': eventType,
          'Tasker-Event-Id': eventId,
          'Tasker-Signature': signedHeader,
          'User-Agent': 'Tasker-Webhooks/1.0',
        },
        body: rawBody,
        signal: controller.signal,
      });
      statusCode = res.status;
      responseSnippet = await this.readSnippet(res);
      if (res.status >= 200 && res.status < 300) {
        outcome = 'success';
      } else {
        error = `HTTP ${res.status}`;
        outcome = 'retry';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      outcome = 'retry';
    } finally {
      clearTimeout(timer);
    }

    const latencySeconds = (Date.now() - startedAt) / 1000;
    const now = new Date();
    await this.prisma.forSystem().webhookDelivery.create({
      data: {
        webhookId,
        eventType,
        eventId,
        attempt,
        statusCode,
        responseSnippet,
        error,
        enqueuedAt: new Date(startedAt),
        deliveredAt: outcome === 'success' ? now : null,
        failedAt: outcome === 'success' ? null : now,
      },
    });

    this.metrics.observeLatency(outcome, latencySeconds);
    if (outcome === 'success') {
      this.metrics.incrementDelivery('success');
      return;
    }

    const maxAttempts = this.config.get<number>('WEBHOOK_MAX_ATTEMPTS', 24);
    if (attempt >= maxAttempts) {
      this.metrics.incrementDelivery('dlq');
      const dlqJob: WebhookDlqJobData = {
        ...job.data,
        lastAttemptAt: now.toISOString(),
        retryCount: attempt,
        lastError: error ?? 'unknown',
      };
      await this.dlq.add(WEBHOOK_DLQ_JOB, dlqJob, {
        removeOnComplete: 100,
        removeOnFail: 100,
      });
      throw new UnrecoverableError(error ?? 'delivery exhausted');
    }

    this.metrics.incrementDelivery('retry');
    // Throwing a regular Error triggers BullMQ's exponential backoff. The
    // per-job attempts/backoff options were set at enqueue time by the
    // dispatcher, so we don't repeat them here.
    throw new Error(error ?? 'delivery failed');
  }

  private async readSnippet(res: Response): Promise<string | null> {
    try {
      const text = await res.text();
      if (text.length <= RESPONSE_SNIPPET_MAX_BYTES) return text;
      return text.slice(0, RESPONSE_SNIPPET_MAX_BYTES);
    } catch {
      return null;
    }
  }
}
