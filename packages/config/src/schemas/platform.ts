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
