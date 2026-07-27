import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Web Push subscription serialisation from PushManager.subscribe().toJSON().
// The endpoint is a full URL and can be a few hundred chars long; keys are
// base64url strings.
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(16).max(256),
    auth: z.string().min(8).max(64),
  }),
  userAgent: z.string().max(256).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export class PushSubscriptionDto extends createZodDto(pushSubscriptionSchema) {}
