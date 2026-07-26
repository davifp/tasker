import { z } from 'zod';
import { cursorSchema } from './pagination';

const isoDateTimeSchema = z
  .string()
  .trim()
  .min(10)
  .max(64)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid ISO date' });

const commaOrArray = (
  max = 32,
): z.ZodEffects<
  z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString>]>>,
  string[] | undefined,
  unknown
> =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value): string[] | undefined => {
      if (value === undefined) return undefined;
      const raw = Array.isArray(value) ? value : value.split(',');
      const cleaned = raw.map((v) => v.trim()).filter((v) => v.length > 0 && v.length <= 128);
      return cleaned.slice(0, max);
    });

/**
 * Filters for both the paginated audit list and the CSV export. All fields are
 * optional; workspace is implicit from the guard context (never accepted in
 * the query string).
 */
export const auditQuerySchema = z.object({
  actorUserId: z.string().min(1).max(64).optional(),
  event: commaOrArray(),
  targetType: commaOrArray(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  cursor: cursorSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;

/** Row cap for a single CSV export — matches techspec (Task 3.0). */
export const AUDIT_CSV_ROW_CAP = 10_000;

/**
 * Metadata keys whose values are always masked before serialization into either
 * the audit row payload or the CSV export. The check is prefix-insensitive and
 * case-insensitive so `apiKey`, `apikey`, `mfaSecret`, `password_hash` all
 * match.
 */
export const AUDIT_SENSITIVE_KEY_PATTERNS = [
  'password',
  'token',
  'secret',
  'apikey',
  'mfa',
  'authorization',
] as const;
