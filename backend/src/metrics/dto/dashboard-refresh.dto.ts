import { createZodDto } from 'nestjs-zod';
import { dashboardRefreshBodySchema } from '@tasker/config';

export class DashboardRefreshDto extends createZodDto(dashboardRefreshBodySchema) {}
