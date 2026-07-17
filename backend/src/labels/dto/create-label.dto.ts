import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { projectColorSchema } from '../../projects/dto/create-project.dto';

export const labelNameSchema = z.string().trim().min(1).max(40);
export const labelColorSchema = projectColorSchema;

export class CreateLabelDto extends createZodDto(
  z.object({
    name: labelNameSchema,
    color: labelColorSchema,
  }),
) {}
