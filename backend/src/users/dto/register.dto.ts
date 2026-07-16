import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100).trim(),
});

export class RegisterDto extends createZodDto(RegisterSchema) {}
