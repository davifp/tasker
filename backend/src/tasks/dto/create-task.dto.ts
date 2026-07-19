import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const taskStatusSchema = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']);
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

// Cross-field invariant enforced at the DTO layer: when both endpoints
// are supplied on the same request, `startDate` must be earlier than or
// equal to `dueDate`. When either side is `null` (Update DTO) or missing
// the check is skipped — the Timeline view can render a task with a
// single endpoint. Mirrors the pattern used by other DTOs in this module
// (`UpdateChecklistItemDto`, `UpdateProjectDto`) — a `.refine` on the
// `createZodDto` object schema.
export function isValidStartDueInterval(input: {
  startDate?: string | null;
  dueDate?: string | null;
}): boolean {
  if (!input.startDate || !input.dueDate) return true;
  return new Date(input.startDate).getTime() <= new Date(input.dueDate).getTime();
}

export const startDueInvariantMessage = 'startDate must be earlier than or equal to dueDate';

export class CreateTaskDto extends createZodDto(
  z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(10_000).optional(),
      priority: taskPrioritySchema.optional(),
      status: taskStatusSchema.optional(),
      assigneeUserId: z.string().cuid().optional(),
      startDate: z.string().datetime().optional(),
      dueDate: z.string().datetime().optional(),
      labelIds: z.array(z.string().cuid()).max(50).optional(),
    })
    .refine(isValidStartDueInterval, {
      message: startDueInvariantMessage,
      path: ['startDate'],
    }),
) {}
