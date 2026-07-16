import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class PasswordResetRequestDto extends createZodDto(
  z.object({ email: z.string().email() }),
) {}
