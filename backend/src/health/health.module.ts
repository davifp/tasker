import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullMQModule } from '../queues/bullmq.module';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { BullMqHealthIndicator } from './bullmq.health';

@Module({
  imports: [TerminusModule, BullMQModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator, BullMqHealthIndicator],
})
export class HealthModule {}
