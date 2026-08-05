import type { WebhookEventType } from '@tasker/config';

/**
 * Payload shape produced by the dispatcher and consumed by both processors.
 * `payload` is the object serialised to the wire; the processor stringifies
 * it once and reuses the exact bytes for both the HTTP body and the
 * signature — anything else and the receiver's HMAC check drifts.
 */
export interface WebhookDeliveryJobData {
  webhookId: string;
  workspaceId: string;
  eventType: WebhookEventType;
  eventId: string;
  payload: Record<string, unknown>;
}

export interface WebhookDlqJobData extends WebhookDeliveryJobData {
  lastAttemptAt: string;
  retryCount: number;
  lastError: string;
}
