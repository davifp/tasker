import { createZodDto } from 'nestjs-zod';
import { auditQuerySchema } from '@tasker/config';

export class AuditQueryDto extends createZodDto(auditQuerySchema) {}
