import { createZodDto } from 'nestjs-zod';
import { listEpicsQuerySchema } from '@tasker/config';

export class ListEpicsQueryDto extends createZodDto(listEpicsQuerySchema) {}
