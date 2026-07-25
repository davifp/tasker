import { z } from 'zod';
import { EPIC_STATUSES, QUARTER_ID_REGEXP } from '../roadmap';
import { cursorSchema, pageLimitSchema } from './pagination';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const epicTitleSchema = z.string().trim().min(1).max(160);
const epicDescriptionSchema = z.string().trim().min(1).max(10_000);
const quarterIdSchema = z
  .string()
  .trim()
  .regex(QUARTER_ID_REGEXP, { message: 'Quarter must match YYYY-Qn' });

const quarterOrder = (q: string): number => {
  const [year, part] = q.split('-Q');
  return Number(year) * 4 + Number(part);
};

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export const createEpicSchema = z
  .object({
    title: epicTitleSchema,
    description: epicDescriptionSchema.optional(),
    startQuarter: quarterIdSchema,
    endQuarter: quarterIdSchema,
    status: z.enum(EPIC_STATUSES).default('PLANNED'),
  })
  .superRefine((v, ctx) => {
    if (quarterOrder(v.endQuarter) < quarterOrder(v.startQuarter)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endQuarter'],
        message: 'endQuarter must be greater than or equal to startQuarter',
      });
    }
  });

export const updateEpicSchema = z
  .object({
    title: epicTitleSchema.optional(),
    description: epicDescriptionSchema.optional().nullable(),
    startQuarter: quarterIdSchema.optional(),
    endQuarter: quarterIdSchema.optional(),
    status: z.enum(EPIC_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  })
  .superRefine((v, ctx) => {
    if (v.startQuarter && v.endQuarter) {
      if (quarterOrder(v.endQuarter) < quarterOrder(v.startQuarter)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endQuarter'],
          message: 'endQuarter must be greater than or equal to startQuarter',
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Roadmap query
// ---------------------------------------------------------------------------

export const roadmapQuerySchema = z
  .object({
    fromQuarter: quarterIdSchema.optional(),
    toQuarter: quarterIdSchema.optional(),
    projectId: z.string().min(1).max(64).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fromQuarter && v.toQuarter) {
      if (quarterOrder(v.toQuarter) < quarterOrder(v.fromQuarter)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toQuarter'],
          message: 'toQuarter must be greater than or equal to fromQuarter',
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Pagination on epics list (per-project)
// ---------------------------------------------------------------------------

export const listEpicsQuerySchema = z.object({
  cursor: cursorSchema,
  limit: pageLimitSchema,
  status: z.enum(EPIC_STATUSES).optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CreateEpicInput = z.infer<typeof createEpicSchema>;
export type UpdateEpicInput = z.infer<typeof updateEpicSchema>;
export type RoadmapQuery = z.infer<typeof roadmapQuerySchema>;
export type ListEpicsQuery = z.infer<typeof listEpicsQuerySchema>;
