import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const projectSlugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9-]+$/, 'slug must contain only lowercase letters, digits, and hyphens');

export const projectColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a hex code like #3b82f6');

export const projectIconSchema = z.string().min(1).max(64);

export class CreateProjectDto extends createZodDto(
  z.object({
    name: z.string().trim().min(1).max(80),
    slug: projectSlugSchema,
    color: projectColorSchema,
    icon: projectIconSchema,
    description: z.string().max(500).optional(),
  }),
) {}
