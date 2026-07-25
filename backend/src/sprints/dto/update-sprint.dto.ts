import { createZodDto } from 'nestjs-zod';
import { updateSprintSchema } from '@tasker/config';

export class UpdateSprintDto extends createZodDto(updateSprintSchema) {}
