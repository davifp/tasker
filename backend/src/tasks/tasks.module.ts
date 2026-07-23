import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { NOTIFICATIONS_QUEUE } from '../queues/constants';
import { TaskChecklistsController } from './checklists/task-checklists.controller';
import { TaskChecklistsService } from './checklists/task-checklists.service';
import { TaskCommentsController } from './comments/task-comments.controller';
import { TaskCommentsService } from './comments/task-comments.service';
import { MentionParser } from './comments/mentions/mention-parser';
import { MentionsController } from './comments/mentions/mentions.controller';
import { MentionsService } from './comments/mentions/mentions.service';
import { ReactionsController } from './comments/reactions/reactions.controller';
import { ReactionsService } from './comments/reactions/reactions.service';
import { TaskDependenciesController } from './dependencies/task-dependencies.controller';
import { TaskDependenciesService } from './dependencies/task-dependencies.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    PrismaModule,
    ProjectsModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [
    TasksController,
    TaskDependenciesController,
    TaskChecklistsController,
    TaskCommentsController,
    MentionsController,
    ReactionsController,
  ],
  providers: [
    TasksService,
    TaskDependenciesService,
    TaskChecklistsService,
    TaskCommentsService,
    MentionParser,
    MentionsService,
    ReactionsService,
  ],
  exports: [TasksService],
})
export class TasksModule {}
