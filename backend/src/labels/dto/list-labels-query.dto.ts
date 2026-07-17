import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class ListLabelsQueryDto extends createZodDto(
  z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
) {}
