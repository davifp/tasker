import { createZodDto } from 'nestjs-zod';
import { createSprintSchema } from '@tasker/config';

export class CreateSprintDto extends createZodDto(createSprintSchema) {}
