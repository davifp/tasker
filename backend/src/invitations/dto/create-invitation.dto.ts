import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class CreateInvitationDto extends createZodDto(
  z.object({
    email: z.string().email().max(320),
    role: z.enum(['ADMIN', 'MEMBER', 'GUEST']),
  }),
) {}
