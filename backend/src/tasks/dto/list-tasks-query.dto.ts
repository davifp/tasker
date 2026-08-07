import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { taskPrioritySchema, taskStatusSchema } from './create-task.dto';

// `labels` on the wire is a comma-separated list of CUIDs (`?labels=a,b`)
// so it fits URLSearchParams cleanly and doesn't require repeated keys.
// Each element must satisfy Zod's `.cuid()` — same shape as the sibling
// `labelId` scalar param, so a valid single-value URL is a valid subset.
const cuidSchema = z.string().cuid();
const labelsQuerySchema = z
  .string()
  .optional()
  .transform((raw): string[] | undefined => {
    if (!raw) return undefined;
    const ids = raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (ids.length === 0) return undefined;
    return ids;
  })
  .refine(
    (ids) => ids === undefined || ids.every((id) => cuidSchema.safeParse(id).success),
    'labels must be a comma-separated list of CUIDs',
  );

// `priority` mirrors the `labels` param shape: a comma-separated list on
// the wire, each element must satisfy the shared `taskPrioritySchema`
// enum. Kept as a single param (not repeated `?priority=HIGH&priority=MEDIUM`)
// so `URLSearchParams` round-trips cleanly and the canonical frontend query
// key stays a scalar string.
const priorityListSchema = z
  .string()
  .optional()
  .transform((raw): Array<'LOW' | 'MEDIUM' | 'HIGH'> | undefined => {
    if (!raw) return undefined;
    const values = raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (values.length === 0) return undefined;
    return values as Array<'LOW' | 'MEDIUM' | 'HIGH'>;
  })
  .refine(
    (values) =>
      values === undefined ||
      values.every((v) => taskPrioritySchema.safeParse(v).success),
    'priority must be a comma-separated list of LOW|MEDIUM|HIGH',
  );

export const sortFieldSchema = z.enum(['dueDate', 'updatedAt', 'priority', 'title', 'position']);
export const sortDirSchema = z.enum(['asc', 'desc']);

export class ListTasksQueryDto extends createZodDto(
  z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: taskStatusSchema.optional(),
    assigneeUserId: z.string().cuid().optional(),
    labelId: z.string().cuid().optional(),
    labels: labelsQuerySchema,
    includeDeleted: z.coerce.boolean().optional(),
    // Sorting — defaults to (`position`, `asc`) at the service layer so the
    // Kanban board behaviour stays byte-identical when neither param is set.
    sort: sortFieldSchema.optional(),
    sortDir: sortDirSchema.optional(),
    // Date window for the Calendar/Timeline views. Semantics implemented in
    // the service: a task is inside the window when
    // (startDate ?? dueDate) < to  AND  (dueDate ?? startDate) >= from —
    // i.e. an interval overlap, tolerating tasks with only one endpoint.
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    // Comma-separated priority filter — union semantics.
    priority: priorityListSchema,
    // Sprint scope: pass a sprint's CUID to filter to its planned tasks, or
    // the literal string `none` to fetch the project's backlog (tasks with
    // no sprint assignment yet). Used by the sprint planner RSC to hydrate
    // both panes from the server.
    sprintId: z.union([z.string().cuid(), z.literal('none')]).optional(),
  }),
) {}
