import { createZodDto } from 'nestjs-zod';
import { capacityUpsertSchema } from '@tasker/config';

export class CapacityUpsertDto extends createZodDto(capacityUpsertSchema) {}
