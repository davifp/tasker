import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { commentBodySchema } from './create-comment.dto';

export class UpdateCommentDto extends createZodDto(
  z.object({
    body: commentBodySchema,
  }),
) {}
