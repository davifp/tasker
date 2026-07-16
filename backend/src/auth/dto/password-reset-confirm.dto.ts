import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class PasswordResetConfirmDto extends createZodDto(
  z.object({
    token: z.string().min(1),
    password: z.string().min(8),
  }),
) {}
