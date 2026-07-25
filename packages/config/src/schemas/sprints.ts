import { z } from 'zod';
import { SPRINT_MIN_DAYS, SPRINT_MAX_DAYS_DEFAULT, SPRINT_STATES } from '../sprint-policy';
import { cursorSchema, pageLimitSchema } from './pagination';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * ISO-8601 date-only string (`YYYY-MM-DD`) or full ISO datetime. The service
 * layer coerces both into a `Date` normalized to workspace midnight; the
 * schema only guards format so the client sees a fast, actionable error.
 */
const isoDateSchema = z
  .string()
  .trim()
  .min(10)
  .max(64)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: 'Invalid ISO date',
  });

const sprintNameSchema = z.string().trim().min(1).max(120);
const sprintGoalSchema = z.string().trim().min(1).max(2000);

const taskIdSchema = z.string().min(1).max(64);
const memberIdSchema = z.string().min(1).max(64);
const capacityPointsSchema = z.number().int().min(0).max(10_000);

const daysBetween = (start: string, end: string): number => {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.round((e - s) / 86_400_000);
};

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export const createSprintSchema = z
  .object({
    name: sprintNameSchema,
    goal: sprintGoalSchema.optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .superRefine((value, ctx) => {
    const span = daysBetween(value.startDate, value.endDate);
    if (span < SPRINT_MIN_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: `Sprint must span at least ${SPRINT_MIN_DAYS} day(s)`,
      });
    }
    if (span > SPRINT_MAX_DAYS_DEFAULT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: `Sprint cannot span more than ${SPRINT_MAX_DAYS_DEFAULT} day(s)`,
      });
    }
  });

export const updateSprintSchema = z
  .object({
    name: sprintNameSchema.optional(),
    goal: sprintGoalSchema.optional().nullable(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

// ---------------------------------------------------------------------------
// Planner mutations
// ---------------------------------------------------------------------------

export const sprintTasksMutationSchema = z
  .object({
    add: z.array(taskIdSchema).max(500).default([]),
    remove: z.array(taskIdSchema).max(500).default([]),
  })
  .refine((v) => v.add.length + v.remove.length > 0, {
    message: 'Provide at least one task to add or remove',
  });

export const capacityEntrySchema = z.object({
  memberUserId: memberIdSchema,
  capacityPoints: capacityPointsSchema,
});

export const capacityUpsertSchema = z.object({
  entries: z.array(capacityEntrySchema).min(1).max(500),
});

// ---------------------------------------------------------------------------
// List / lookup
// ---------------------------------------------------------------------------

export const listSprintsQuerySchema = z.object({
  cursor: cursorSchema,
  limit: pageLimitSchema,
  state: z.enum(SPRINT_STATES).optional(),
});

export const sprintNumberParamSchema = z.object({
  sprintNumber: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CreateSprintInput = z.infer<typeof createSprintSchema>;
export type UpdateSprintInput = z.infer<typeof updateSprintSchema>;
export type SprintTasksMutationInput = z.infer<typeof sprintTasksMutationSchema>;
export type CapacityEntry = z.infer<typeof capacityEntrySchema>;
export type CapacityUpsertInput = z.infer<typeof capacityUpsertSchema>;
export type ListSprintsQuery = z.infer<typeof listSprintsQuerySchema>;
export type SprintNumberParam = z.infer<typeof sprintNumberParamSchema>;
