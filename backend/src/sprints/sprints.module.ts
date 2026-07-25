import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityModule } from '../common/activity/activity.module';
import { SprintsController } from './sprints.controller';
import { SprintsService } from './sprints.service';
import { SprintPlannerService } from './sprint-planner.service';
import { SprintSnapshotService } from './sprint-snapshot.service';

@Module({
  imports: [PrismaModule, ActivityModule],
  controllers: [SprintsController],
  providers: [SprintsService, SprintPlannerService, SprintSnapshotService],
  exports: [SprintsService, SprintPlannerService, SprintSnapshotService],
})
export class SprintsModule {}
