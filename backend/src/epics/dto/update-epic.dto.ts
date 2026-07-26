import { createZodDto } from 'nestjs-zod';
import { updateEpicSchema } from '@tasker/config';

export class UpdateEpicDto extends createZodDto(updateEpicSchema) {}
