import { Module } from '@nestjs/common';
import { ProjectsModule } from '../../projects/projects.module';
import { TasksModule } from '../../tasks/tasks.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PublicMeController } from './public-me.controller';
import { PublicProjectsController } from './public-projects.controller';
import { PublicTasksController } from './public-tasks.controller';

/**
 * Public REST surface for API-key–authenticated automations. Every route is
 * mounted under `/api/v1/public/` (global prefix + module prefix) so paths
 * never collide with the JWT admin surface, and clients get an unambiguous
 * "this is the versioned public contract" URL to point their scripts at.
 */
@Module({
  imports: [ApiKeysModule, ProjectsModule, TasksModule],
  controllers: [PublicMeController, PublicProjectsController, PublicTasksController],
})
export class PublicModule {}
