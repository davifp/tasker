import { z } from 'zod';
import { cursorSchema } from './pagination';

export const SEARCH_ENTITY_TYPES = ['task', 'project', 'member', 'sprint'] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

const searchQuerySchema = z.string().trim().min(1).max(100);

const commaSeparatedTypes = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value): SearchEntityType[] | undefined => {
    if (value === undefined) return undefined;
    const raw = Array.isArray(value) ? value : value.split(',');
    return raw
      .map((v) => v.trim().toLowerCase())
      .filter((v): v is SearchEntityType => (SEARCH_ENTITY_TYPES as readonly string[]).includes(v));
  });

const isoDateTimeSchema = z
  .string()
  .trim()
  .min(10)
  .max(64)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid ISO date' });

/**
 * Global search query — used by ⌘K and the /search page.
 *
 * The service layer trusts these bounds; anything beyond `q.max=100` or
 * `limit.max=50` is either accidental (paste) or hostile (regex/DoS attempt).
 */
export const searchQuerySchemaDto = z.object({
  q: searchQuerySchema,
  type: commaSeparatedTypes,
  projectId: z.string().min(1).max(64).optional(),
  authorUserId: z.string().min(1).max(64).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  cursor: cursorSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchemaDto>;
