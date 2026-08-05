import { updateWebhookSchema } from '@tasker/config';
import { createZodDto } from 'nestjs-zod';

export class UpdateWebhookDto extends createZodDto(updateWebhookSchema) {}
