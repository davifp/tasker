import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class CreateDependencyDto extends createZodDto(
  z.object({
    blockedByTaskId: z.string().min(1),
  }),
) {}
