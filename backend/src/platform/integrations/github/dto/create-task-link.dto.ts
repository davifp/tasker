import { createTaskLinkSchema } from '@tasker/config';
import { createZodDto } from 'nestjs-zod';

export class CreateTaskLinkDto extends createZodDto(createTaskLinkSchema) {}
