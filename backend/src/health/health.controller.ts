import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';

@Public()
// @SkipThrottle() with no args only skips the 'default' throttler.
// Named throttlers still run — and their storage would blow up if Redis is
// unreachable, turning any /health request during a Redis outage into a 500
// instead of the intended 503. List every throttler explicitly.
@SkipThrottle({
  default: true,
  register: true,
  login: true,
  refresh: true,
  emailResend: true,
  passwordReset: true,
})
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
