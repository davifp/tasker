import { listApiKeysQuerySchema } from '@tasker/config';
import { createZodDto } from 'nestjs-zod';

export class ListApiKeysQueryDto extends createZodDto(listApiKeysQuerySchema) {}
