import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { taskStatusSchema } from './create-task.dto';

export class ListTasksQueryDto extends createZodDto(
  z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: taskStatusSchema.optional(),
    assigneeUserId: z.string().cuid().optional(),
    labelId: z.string().cuid().optional(),
    includeDeleted: z.coerce.boolean().optional(),
  }),
) {}
