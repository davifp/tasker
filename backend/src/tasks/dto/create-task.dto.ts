import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const taskStatusSchema = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']);
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export class CreateTaskDto extends createZodDto(
  z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).optional(),
    priority: taskPrioritySchema.optional(),
    status: taskStatusSchema.optional(),
    assigneeUserId: z.string().cuid().optional(),
    dueDate: z.string().datetime().optional(),
    labelIds: z.array(z.string().cuid()).max(50).optional(),
  }),
) {}
