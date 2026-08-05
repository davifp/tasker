import { listWebhookDeliveriesQuerySchema } from '@tasker/config';
import { createZodDto } from 'nestjs-zod';

export class ListWebhookDeliveriesQueryDto extends createZodDto(listWebhookDeliveriesQuerySchema) {}
