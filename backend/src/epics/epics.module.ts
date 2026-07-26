import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ActivityModule } from '../common/activity/activity.module';
import { EpicsController } from './epics.controller';
import { EpicsService } from './epics.service';
import { RoadmapController } from './roadmap.controller';

@Module({
  imports: [PrismaModule, ActivityModule],
  controllers: [EpicsController, RoadmapController],
  providers: [EpicsService],
  exports: [EpicsService],
})
export class EpicsModule {}
