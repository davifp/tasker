import { z } from 'zod';

/**
 * Wire-format scope strings for platform API keys. The Prisma `ApiKeyScope`
 * enum mirrors these but uses UPPER_SNAKE identifiers because Postgres enum
 * members can't contain colons — `TASKS_READ` there ↔ `tasks:read` here.
 * Scopes are persisted on `ApiKey.scopes` as a JSON array of these strings.
 */
export const API_KEY_SCOPES = [
  'tasks:read',
  'tasks:write',
  'projects:read',
  'projects:write',
  'comments:read',
  'comments:write',
  'sprints:read',
  'sprints:write',
  'members:read',
  'webhooks:manage',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);

// Names are chosen by the admin and shown in the settings table, so we keep
// them printable-only and bounded.
export const apiKeyNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(60, 'Name must be at most 60 characters');

export const createApiKeySchema = z.object({
  name: apiKeyNameSchema,
  scopes: z
    .array(apiKeyScopeSchema)
    .min(1, 'At least one scope is required')
    .max(API_KEY_SCOPES.length),
  // ISO-8601 timestamp; the API layer validates it is strictly in the future.
  expiresAt: z.string().datetime().optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const listApiKeysQuerySchema = z.object({
  includeRevoked: z.coerce.boolean().optional(),
});
export type ListApiKeysQuery = z.infer<typeof listApiKeysQuerySchema>;

// Outbound webhook subscriptions. Event names mirror the Prisma
// `WebhookEventType` enum values (UPPER_SNAKE) so subscribers depend on a
// stable wire alphabet — a rename requires bumping both the enum and this list.
export const WEBHOOK_EVENT_TYPES = [
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_DELETED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_DELETED',
  'COMMENT_CREATED',
  'COMMENT_UPDATED',
  'COMMENT_DELETED',
  'SPRINT_CREATED',
  'SPRINT_UPDATED',
  'SPRINT_STARTED',
  'SPRINT_COMPLETED',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const webhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);

const webhookUrlSchema = z
  .string()
  .url('URL must be a valid absolute URL')
  .max(500, 'URL must be at most 500 characters')
  .refine((v) => /^https?:\/\//i.test(v), 'URL scheme must be http or https');

export const createWebhookSchema = z.object({
  url: webhookUrlSchema,
  eventTypes: z
    .array(webhookEventTypeSchema)
    .min(1, 'At least one event type is required')
    .max(WEBHOOK_EVENT_TYPES.length),
  isActive: z.boolean().optional(),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({
    url: webhookUrlSchema.optional(),
    eventTypes: z
      .array(webhookEventTypeSchema)
      .min(1, 'At least one event type is required')
      .max(WEBHOOK_EVENT_TYPES.length)
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.url !== undefined || v.eventTypes !== undefined || v.isActive !== undefined, {
    message: 'At least one field must be provided',
  });
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

export const listWebhookDeliveriesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type ListWebhookDeliveriesQuery = z.infer<typeof listWebhookDeliveriesQuerySchema>;
