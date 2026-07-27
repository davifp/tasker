import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { notificationChannelSchema, notificationEventTypeSchema } from '@tasker/config';

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  unreadOnly: z
    .union([z.enum(['true', 'false']), z.boolean()])
    .default(false)
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true')),
  type: notificationEventTypeSchema.optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export class ListNotificationsQueryDto extends createZodDto(listNotificationsQuerySchema) {}

export const preferenceEntrySchema = z.object({
  eventType: notificationEventTypeSchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
});
export type PreferenceEntry = z.infer<typeof preferenceEntrySchema>;

export const updatePreferencesBodySchema = z.object({
  preferences: z.array(preferenceEntrySchema).min(1).max(12),
});
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesBodySchema>;
export class UpdatePreferencesBodyDto extends createZodDto(updatePreferencesBodySchema) {}
