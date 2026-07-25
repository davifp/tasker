import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectsModule } from '../../projects/projects.module';
import { ATTACHMENTS_QUEUE } from '../../queues/constants';
import { AttachmentsJanitorProcessor } from '../../queues/attachments-janitor.processor';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { TasksModule } from '../tasks.module';

@Module({
  imports: [
    PrismaModule,
    ProjectsModule,
    TasksModule,
    BullModule.registerQueue({ name: ATTACHMENTS_QUEUE }),
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentsJanitorProcessor],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
