import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';
import { BullMqHealthIndicator } from './bullmq.health';
import { StorageHealthIndicator } from './storage.health';
import { LlmHealthIndicator } from './llm.health';
import { HealthMetrics } from './health.metrics';

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
  aiAction: true,
})
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly bullmqIndicator: BullMqHealthIndicator,
    private readonly storageIndicator: StorageHealthIndicator,
    private readonly llmIndicator: LlmHealthIndicator,
    private readonly metrics: HealthMetrics,
  ) {}

  /**
   * Liveness — process is up. Kept deliberately shallow (no I/O) so a
   * transient dependency outage does not kill the container.
   */
  @Get('liveness')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness — the process is fit to serve traffic. Fails if any of the
   * critical dependencies is unreachable; returns per-dependency status in
   * the Terminus body so ops can pinpoint the blast radius.
   */
  @Get('readiness')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    try {
      const result = await this.health.check([
        () => this.prismaIndicator.isHealthy('postgres'),
        () => this.redisIndicator.isHealthy('redis'),
        () => this.bullmqIndicator.isHealthy('bullmq'),
        () => this.storageIndicator.isHealthy('storage'),
        () => this.llmIndicator.isHealthy('llm'),
      ]);
      this.record(result.info ?? {}, result.error ?? {});
      return result;
    } catch (err) {
      // Terminus throws ServiceUnavailableException on failure with the
      // per-dependency payload inside .getResponse(). Extract it so metrics
      // reflect reality. For any other bubbled error (indicator threw a
      // non-Terminus exception, unexpected framework error, …) still record
      // a full failure so `tasker_readiness_ok` cannot go stale through the
      // very outage it should flag.
      if (err instanceof ServiceUnavailableException) {
        const body = err.getResponse() as {
          info?: Record<string, { status?: string }>;
          error?: Record<string, { status?: string }>;
        };
        this.record(body.info ?? {}, body.error ?? {});
      } else {
        this.record({}, { postgres: {}, redis: {}, bullmq: {}, storage: {}, llm: {} });
      }
      throw err;
    }
  }

  /**
   * Legacy shallow health — kept for back-compat with the pre-split probes
   * that only knew about `/health`. Checks Postgres, Redis, and BullMQ; does
   * NOT probe storage or the LLM (those live under `/readiness` and are
   * more expensive). Callers wanting the full picture should migrate.
   */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.isHealthy('prisma'),
      () => this.redisIndicator.isHealthy('redis'),
      () => this.bullmqIndicator.isHealthy('bullmq'),
    ]);
  }

  private record(
    info: Record<string, { status?: string } | undefined>,
    error: Record<string, { status?: string } | undefined>,
  ): void {
    const deps: Record<string, boolean> = {};
    for (const key of Object.keys(info)) deps[key] = info[key]?.status === 'up';
    for (const key of Object.keys(error)) deps[key] = false;
    this.metrics.record(deps);
  }
}
