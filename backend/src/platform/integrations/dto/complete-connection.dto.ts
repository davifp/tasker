import { completeIntegrationConnectionSchema } from '@tasker/config';
import { createZodDto } from 'nestjs-zod';

export class CompleteIntegrationConnectionDto extends createZodDto(
  completeIntegrationConnectionSchema,
) {}
