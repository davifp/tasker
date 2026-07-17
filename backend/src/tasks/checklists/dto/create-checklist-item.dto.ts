import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const checklistTitleSchema = z.string().trim().min(1).max(200);

export class CreateChecklistItemDto extends createZodDto(
  z.object({
    title: checklistTitleSchema,
  }),
) {}
