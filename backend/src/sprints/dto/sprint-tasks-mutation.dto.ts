import { createZodDto } from 'nestjs-zod';
import { sprintTasksMutationSchema } from '@tasker/config';

export class SprintTasksMutationDto extends createZodDto(sprintTasksMutationSchema) {}
