import { createZodDto } from 'nestjs-zod';
import { createEpicSchema } from '@tasker/config';

export class CreateEpicDto extends createZodDto(createEpicSchema) {}
