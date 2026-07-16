import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class VerifyEmailDto extends createZodDto(z.object({ token: z.string().min(1) })) {}
