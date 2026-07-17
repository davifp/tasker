import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const commentBodySchema = z.string().trim().min(1).max(10_000);

export class CreateCommentDto extends createZodDto(
  z.object({
    body: commentBodySchema,
  }),
) {}
