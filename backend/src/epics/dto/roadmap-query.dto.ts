import { createZodDto } from 'nestjs-zod';
import { roadmapQuerySchema } from '@tasker/config';

export class RoadmapQueryDto extends createZodDto(roadmapQuerySchema) {}
