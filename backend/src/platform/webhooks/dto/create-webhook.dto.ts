import { createWebhookSchema } from '@tasker/config';
import { createZodDto } from 'nestjs-zod';

export class CreateWebhookDto extends createZodDto(createWebhookSchema) {}
