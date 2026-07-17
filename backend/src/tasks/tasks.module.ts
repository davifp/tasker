import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { TaskChecklistsController } from './checklists/task-checklists.controller';
import { TaskChecklistsService } from './checklists/task-checklists.service';
import { TaskCommentsController } from './comments/task-comments.controller';
import { TaskCommentsService } from './comments/task-comments.service';
import { TaskDependenciesController } from './dependencies/task-dependencies.controller';
import { TaskDependenciesService } from './dependencies/task-dependencies.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [PrismaModule, ProjectsModule],
  controllers: [
    TasksController,
    TaskDependenciesController,
    TaskChecklistsController,
    TaskCommentsController,
  ],
  providers: [
    TasksService,
    TaskDependenciesService,
    TaskChecklistsService,
    TaskCommentsService,
  ],
  exports: [TasksService],
})
export class TasksModule {}
