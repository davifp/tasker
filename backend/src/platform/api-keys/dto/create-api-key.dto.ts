import { createApiKeySchema } from '@tasker/config';
import { createZodDto } from 'nestjs-zod';

export class CreateApiKeyDto extends createZodDto(createApiKeySchema) {}
