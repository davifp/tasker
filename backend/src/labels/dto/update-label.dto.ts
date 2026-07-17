import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { labelColorSchema, labelNameSchema } from './create-label.dto';

export class UpdateLabelDto extends createZodDto(
  z
    .object({
      name: labelNameSchema.optional(),
      color: labelColorSchema.optional(),
    })
    .refine((v) => Object.values(v).some((f) => f !== undefined), {
      message: 'At least one field is required',
    }),
) {}
