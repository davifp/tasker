import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { projectColorSchema, projectIconSchema } from './create-project.dto';

export class UpdateProjectDto extends createZodDto(
  z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      color: projectColorSchema.optional(),
      icon: projectIconSchema.optional(),
      description: z.string().max(500).nullable().optional(),
      status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
    })
    .refine((v) => Object.values(v).some((f) => f !== undefined), {
      message: 'At least one field is required',
    }),
) {}
