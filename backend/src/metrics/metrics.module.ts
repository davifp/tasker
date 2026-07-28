import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { SprintsModule } from '../sprints/sprints.module';
import { RedisModule } from '../common/redis/redis.module';
import { METRICS_QUEUE } from '../queues/constants';
import { DashboardController } from './dashboard.controller';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsRefreshProcessor } from './metrics-refresh.processor';
import { TaskStatusChangedListener } from './task-status-changed.listener';
import { PlanningMetricsCollector } from './planning.metrics';
import { SearchAuditMetricsCollector } from './search-audit.metrics';
import { RealtimeMetricsCollector } from './realtime.metrics';
import { NotificationsMetricsCollector } from './notifications.metrics';
import { AiMetricsCollector } from '../ai/metrics/ai.metrics';

@Global()
@Module({
  imports: [
    PrismaModule,
    SprintsModule,
    RedisModule,
    BullModule.registerQueue({ name: METRICS_QUEUE }),
  ],
  controllers: [DashboardController, MetricsController],
  providers: [
    MetricsService,
    MetricsRefreshProcessor,
    TaskStatusChangedListener,
    PlanningMetricsCollector,
    SearchAuditMetricsCollector,
    RealtimeMetricsCollector,
    NotificationsMetricsCollector,
    AiMetricsCollector,
  ],
  exports: [
    MetricsService,
    PlanningMetricsCollector,
    SearchAuditMetricsCollector,
    RealtimeMetricsCollector,
    NotificationsMetricsCollector,
    AiMetricsCollector,
  ],
})
export class MetricsModule {}
