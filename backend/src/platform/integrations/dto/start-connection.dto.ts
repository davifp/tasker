import { startIntegrationConnectionSchema } from '@tasker/config';
import { createZodDto } from 'nestjs-zod';

export class StartIntegrationConnectionDto extends createZodDto(startIntegrationConnectionSchema) {}
