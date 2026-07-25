import { z } from 'zod';

/**
 * Cursor pagination primitives reused across every Planning list endpoint.
 * Matches the shape already defined in `collaboration/schemas.ts` so the
 * repo-wide convention stays consistent (see techspec.md → "API endpoints").
 */
export const cursorSchema = z.string().min(1).max(512).optional();

export const pageLimitSchema = z.coerce.number().int().min(1).max(100).default(50);
