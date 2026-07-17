import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { taskStatusSchema } from './create-task.dto';

// Fractional-indexing keys start with an alphabetic head (A-Z or a-z) that
// encodes the integer part's length, followed by digits from BASE_62. The
// regex is permissive on purpose — the library validates on generation.
export const positionKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z][0-9A-Za-z]*$/, 'position must be a fractional-indexing key');

export class MoveTaskDto extends createZodDto(
  z.object({
    status: taskStatusSchema,
    position: positionKeySchema,
    ifUnchangedSince: z.string().datetime(),
    // Explicit acknowledgment that the caller understands moving to DONE
    // will close the task while some blockers remain open. Required to
    // succeed a DONE transition that would otherwise return
    // `acknowledgedBlockersOpen`.
    overrideBlockers: z.boolean().optional(),
  }),
) {}
