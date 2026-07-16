import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class UpdateWorkspaceDto extends createZodDto(
  z.object({
    name: z.string().min(1).max(80).optional(),
  }),
) {}
