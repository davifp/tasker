import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Webhook, WebhookDelivery, WebhookDeliveryDLQ } from '@prisma/client';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@tasker/config';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookSigner } from './webhook-signer';

export interface CreateWebhookInput {
  workspaceId: string;
  actorUserId: string;
  url: string;
  eventTypes: readonly WebhookEventType[];
  isActive?: boolean;
}

export interface UpdateWebhookInput {
  workspaceId: string;
  webhookId: string;
  url?: string;
  eventTypes?: readonly WebhookEventType[];
  isActive?: boolean;
}

export interface WebhookSummary {
  id: string;
  url: string;
  eventTypes: WebhookEventType[];
  isActive: boolean;
  secretRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
}

export interface CreateWebhookResult {
  webhook: WebhookSummary;
  /** The raw secret, shown to the caller exactly once. */
  rawSecret: string;
}

export interface RotateSecretResult {
  webhook: WebhookSummary;
  rawSecret: string;
}

export interface WebhookDeliverySummary {
  id: string;
  webhookId: string;
  eventType: WebhookEventType;
  eventId: string;
  attempt: number;
  statusCode: number | null;
  responseSnippet: string | null;
  error: string | null;
  enqueuedAt: string;
  deliveredAt: string | null;
  failedAt: string | null;
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: WebhookSigner,
  ) {}

  async create(input: CreateWebhookInput): Promise<CreateWebhookResult> {
    this.assertKnownEventTypes(input.eventTypes);
    const secret = this.signer.generateSecret();
    const row = await this.prisma.forSystem().webhook.create({
      data: {
        workspaceId: input.workspaceId,
        createdByUserId: input.actorUserId,
        url: input.url,
        eventTypes: [...input.eventTypes],
        secretHash: secret.hash,
        secretSalt: secret.salt,
        isActive: input.isActive ?? true,
      },
    });
    return { webhook: this.toSummary(row), rawSecret: secret.raw };
  }

  async list(workspaceId: string): Promise<WebhookSummary[]> {
    const rows = await this.prisma.forSystem().webhook.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async findOne(workspaceId: string, webhookId: string): Promise<WebhookSummary> {
    const row = await this.requireOwned(workspaceId, webhookId);
    return this.toSummary(row);
  }

  async update(input: UpdateWebhookInput): Promise<WebhookSummary> {
    await this.requireOwned(input.workspaceId, input.webhookId);
    if (input.eventTypes) this.assertKnownEventTypes(input.eventTypes);
    const updated = await this.prisma.forSystem().webhook.update({
      where: { id: input.webhookId },
      data: {
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.eventTypes ? { eventTypes: [...input.eventTypes] } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return this.toSummary(updated);
  }

  async remove(workspaceId: string, webhookId: string): Promise<void> {
    await this.requireOwned(workspaceId, webhookId);
    await this.prisma.forSystem().webhook.delete({ where: { id: webhookId } });
  }

  // Rotating the secret invalidates the previous secret for any *new*
  // delivery — the dispatcher reads the current hash on each enqueue, so the
  // longest possible window a receiver keeps trusting the old secret is one
  // in-flight batch. The old raw secret is never returned again.
  async rotateSecret(workspaceId: string, webhookId: string): Promise<RotateSecretResult> {
    await this.requireOwned(workspaceId, webhookId);
    const secret = this.signer.generateSecret();
    const updated = await this.prisma.forSystem().webhook.update({
      where: { id: webhookId },
      data: {
        secretHash: secret.hash,
        secretSalt: secret.salt,
        secretRotatedAt: new Date(),
      },
    });
    return { webhook: this.toSummary(updated), rawSecret: secret.raw };
  }

  async findActiveSubscribers(
    workspaceId: string,
    eventType: WebhookEventType,
  ): Promise<Array<{ id: string; url: string; secretHash: string; secretSalt: string }>> {
    const rows = await this.prisma.forSystem().webhook.findMany({
      where: { workspaceId, isActive: true, eventTypes: { has: eventType } },
      select: { id: true, url: true, secretHash: true, secretSalt: true },
    });
    return rows;
  }

  async listDeliveries(
    workspaceId: string,
    webhookId: string,
    options: { cursor?: string; limit?: number },
  ): Promise<{ items: WebhookDeliverySummary[]; nextCursor: string | null }> {
    await this.requireOwned(workspaceId, webhookId);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const rows = await this.prisma.forSystem().webhookDelivery.findMany({
      where: { webhookId },
      orderBy: [{ enqueuedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => this.toDeliverySummary(row)),
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1]!.id : null,
    };
  }

  async listDeadLetter(
    workspaceId: string,
    webhookId: string,
  ): Promise<
    Array<{
      id: string;
      eventType: WebhookEventType;
      eventId: string;
      retryCount: number;
      lastAttemptAt: string;
      expiresAt: string;
      createdAt: string;
    }>
  > {
    await this.requireOwned(workspaceId, webhookId);
    const rows = await this.prisma.forSystem().webhookDeliveryDLQ.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row: WebhookDeliveryDLQ) => ({
      id: row.id,
      eventType: row.eventType as WebhookEventType,
      eventId: row.eventId,
      retryCount: row.retryCount,
      lastAttemptAt: row.lastAttemptAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getWebhookForDelivery(webhookId: string): Promise<Webhook | null> {
    return this.prisma.forSystem().webhook.findUnique({ where: { id: webhookId } });
  }

  private async requireOwned(workspaceId: string, webhookId: string): Promise<Webhook> {
    const row = await this.prisma.forSystem().webhook.findFirst({
      where: { id: webhookId, workspaceId },
    });
    if (!row) {
      throw new NotFoundException({
        type: 'https://tasker.dev/problems/webhook-not-found',
        title: 'Webhook not found',
        status: 404,
      });
    }
    return row;
  }

  private assertKnownEventTypes(events: readonly WebhookEventType[]): void {
    for (const event of events) {
      if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(event)) {
        throw new BadRequestException({
          type: 'https://tasker.dev/problems/webhook-invalid-event',
          title: `Unknown event type: ${event}`,
          status: 400,
        });
      }
    }
  }

  private toSummary(row: Webhook): WebhookSummary {
    return {
      id: row.id,
      url: row.url,
      eventTypes: (row.eventTypes as string[]).filter((e): e is WebhookEventType =>
        (WEBHOOK_EVENT_TYPES as readonly string[]).includes(e),
      ),
      isActive: row.isActive,
      secretRotatedAt: row.secretRotatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdByUserId: row.createdByUserId,
    };
  }

  private toDeliverySummary(row: WebhookDelivery): WebhookDeliverySummary {
    return {
      id: row.id,
      webhookId: row.webhookId,
      eventType: row.eventType as WebhookEventType,
      eventId: row.eventId,
      attempt: row.attempt,
      statusCode: row.statusCode,
      responseSnippet: row.responseSnippet,
      error: row.error,
      enqueuedAt: row.enqueuedAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
    };
  }
}
