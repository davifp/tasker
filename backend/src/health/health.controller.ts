import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('prisma'),
      () => this.redisIndicator.isHealthy('redis'),
    ]);
  }
}
