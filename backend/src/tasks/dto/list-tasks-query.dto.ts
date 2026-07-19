import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { taskStatusSchema } from './create-task.dto';

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

export class ListTasksQueryDto extends createZodDto(
  z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: taskStatusSchema.optional(),
    assigneeUserId: z.string().cuid().optional(),
    labelId: z.string().cuid().optional(),
    labels: labelsQuerySchema,
    includeDeleted: z.coerce.boolean().optional(),
  }),
) {}
