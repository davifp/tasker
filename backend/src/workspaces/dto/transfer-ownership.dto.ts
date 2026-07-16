import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class TransferOwnershipDto extends createZodDto(
  z.object({
    newOwnerUserId: z.string().min(1),
  }),
) {}
