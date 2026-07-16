import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const slugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9-]+$/, 'slug must contain only lowercase letters, digits, and hyphens');

export class CreateWorkspaceDto extends createZodDto(
  z.object({
    name: z.string().min(1).max(80),
    slug: slugSchema,
  }),
) {}
