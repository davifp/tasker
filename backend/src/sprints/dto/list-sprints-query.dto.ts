import { createZodDto } from 'nestjs-zod';
import { listSprintsQuerySchema } from '@tasker/config';

export class ListSprintsQueryDto extends createZodDto(listSprintsQuerySchema) {}
