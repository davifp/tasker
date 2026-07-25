import { z } from 'zod';
import { METRICS_WINDOW_PRESETS, METRICS_DEFAULT_WINDOW } from '../metrics';

/**
 * Cycle- and lead-time window selector. Presets are the primary UI, but the
 * schema also accepts an explicit `from`/`to` for custom windows so the
 * dashboard can offer "custom range" later without a breaking change.
 */
export const cycleLeadTimeQuerySchema = z
  .object({
    window: z.enum(METRICS_WINDOW_PRESETS).default(METRICS_DEFAULT_WINDOW),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    projectId: z.string().min(1).max(64).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.from && !v.to) || (!v.from && v.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: '`from` and `to` must be provided together',
      });
    }
    if (v.from && v.to && new Date(v.from).getTime() > new Date(v.to).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: '`to` must be greater than or equal to `from`',
      });
    }
  });

/**
 * The burndown endpoint is keyed entirely by URL params (`projectSlug` +
 * `sprintNumber`), so the query schema only carries a debug toggle. Keeping
 * a schema here rather than an empty object lets the controller wire it
 * through `ZodValidationPipe` without a special case.
 */
export const burndownQuerySchema = z.object({
  // Explicit `'true'/'false'` coercion — `z.coerce.boolean()` treats every
  // non-empty string as `true`, which silently ignores `?includeIdeal=false`.
  includeIdeal: z
    .union([z.enum(['true', 'false']), z.boolean()])
    .default(true)
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true')),
});

/**
 * Owner-only manual refresh (PRD FR-29 escape hatch). Body is intentionally
 * empty; the schema documents that shape and keeps the DTO layer uniform.
 */
export const dashboardRefreshBodySchema = z.object({}).strict();

export type CycleLeadTimeQuery = z.infer<typeof cycleLeadTimeQuerySchema>;
export type BurndownQuery = z.infer<typeof burndownQuerySchema>;
export type DashboardRefreshBody = z.infer<typeof dashboardRefreshBodySchema>;
