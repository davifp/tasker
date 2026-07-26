import { createZodDto } from 'nestjs-zod';
import { cycleLeadTimeQuerySchema } from '@tasker/config';

export class CycleLeadTimeQueryDto extends createZodDto(cycleLeadTimeQuerySchema) {}
