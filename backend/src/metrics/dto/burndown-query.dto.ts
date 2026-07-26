import { createZodDto } from 'nestjs-zod';
import { burndownQuerySchema } from '@tasker/config';

export class BurndownQueryDto extends createZodDto(burndownQuerySchema) {}
