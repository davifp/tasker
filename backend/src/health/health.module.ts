import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullMQModule } from '../queues/bullmq.module';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { BullMqHealthIndicator } from './bullmq.health';
import { StorageHealthIndicator } from './storage.health';
import { LlmHealthIndicator } from './llm.health';
import { HealthMetrics } from './health.metrics';

@Module({
  imports: [TerminusModule, BullMQModule],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator,
    RedisHealthIndicator,
    BullMqHealthIndicator,
    StorageHealthIndicator,
    LlmHealthIndicator,
    HealthMetrics,
  ],
})
export class HealthModule {}
