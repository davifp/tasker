import { createZodDto } from 'nestjs-zod';
import { searchQuerySchemaDto } from '@tasker/config';

export class SearchQueryDto extends createZodDto(searchQuerySchemaDto) {}
