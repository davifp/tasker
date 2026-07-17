import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { taskPrioritySchema } from './create-task.dto';

export class UpdateTaskDto extends createZodDto(
  z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(10_000).optional(),
      priority: taskPrioritySchema.optional(),
      assigneeUserId: z.string().cuid().nullable().optional(),
      dueDate: z.string().datetime().nullable().optional(),
      labelIds: z.array(z.string().cuid()).max(50).optional(),
    })
    .refine((v) => Object.values(v).some((f) => f !== undefined), {
      message: 'At least one field is required',
    }),
) {}
