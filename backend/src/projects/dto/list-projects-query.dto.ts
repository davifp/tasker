import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class ListProjectsQueryDto extends createZodDto(
  z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
    includeDeleted: z.coerce.boolean().optional(),
  }),
) {}
