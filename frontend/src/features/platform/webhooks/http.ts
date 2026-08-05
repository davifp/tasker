import { browserHttp } from '@/lib/http/browser';
import type { WebhookEventType } from '@tasker/config';

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

export interface DlqRow {
  id: string;
  eventType: WebhookEventType;
  eventId: string;
  retryCount: number;
  lastAttemptAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface CreateWebhookInput {
  url: string;
  eventTypes: WebhookEventType[];
  isActive?: boolean;
}

export interface UpdateWebhookInput {
  url?: string;
  eventTypes?: WebhookEventType[];
  isActive?: boolean;
}

export interface CreateWebhookResponse {
  webhook: WebhookSummary;
  rawSecret: string;
}

export interface RotateSecretResponse {
  webhook: WebhookSummary;
  rawSecret: string;
}

function base(slug: string): string {
  return `/workspaces/${encodeURIComponent(slug)}/webhooks`;
}

export const webhooksHttp = {
  list(slug: string): Promise<{ items: WebhookSummary[] }> {
    return browserHttp.get<{ items: WebhookSummary[] }>(base(slug));
  },
  create(
    slug: string,
    input: CreateWebhookInput,
    idempotencyKey: string,
  ): Promise<CreateWebhookResponse> {
    return browserHttp.post<CreateWebhookResponse>(base(slug), input, { idempotencyKey });
  },
  update(slug: string, id: string, input: UpdateWebhookInput): Promise<WebhookSummary> {
    return browserHttp.patch<WebhookSummary>(`${base(slug)}/${encodeURIComponent(id)}`, input);
  },
  remove(slug: string, id: string): Promise<void> {
    return browserHttp.delete<void>(`${base(slug)}/${encodeURIComponent(id)}`);
  },
  rotateSecret(slug: string, id: string, idempotencyKey: string): Promise<RotateSecretResponse> {
    return browserHttp.post<RotateSecretResponse>(
      `${base(slug)}/${encodeURIComponent(id)}/rotate-secret`,
      undefined,
      { idempotencyKey },
    );
  },
  listDeliveries(
    slug: string,
    id: string,
    opts: { cursor?: string; limit?: number } = {},
  ): Promise<{ items: WebhookDeliverySummary[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.limit) params.set('limit', String(opts.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return browserHttp.get<{ items: WebhookDeliverySummary[]; nextCursor: string | null }>(
      `${base(slug)}/${encodeURIComponent(id)}/deliveries${query}`,
    );
  },
  listDlq(slug: string, id: string): Promise<{ items: DlqRow[] }> {
    return browserHttp.get<{ items: DlqRow[] }>(`${base(slug)}/${encodeURIComponent(id)}/dlq`);
  },
};
