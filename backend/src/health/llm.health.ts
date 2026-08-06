import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import type { Env } from '@tasker/config';
import { LlmRouter } from '../ai/providers/llm-router';

interface CachedResult {
  healthy: boolean;
  detail?: string;
  expiresAt: number;
}

/**
 * Readiness probe for the default LLM provider. Deep readiness scrapes hit
 * every probe on each interval — hammering the provider's `/v1/models`
 * endpoint at that cadence would waste quota and could trip a rate-limit
 * bucket, so positive results are cached for `LLM_HEALTH_CACHE_TTL_MS`.
 * Failures are NOT cached: an outage should recover as fast as the provider
 * does.
 */
@Injectable()
export class LlmHealthIndicator extends HealthIndicator {
  private cached?: CachedResult;

  constructor(
    private readonly router: LlmRouter,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      if (this.cached.healthy) return this.getStatus(key, true, { cached: true });
      throw new HealthCheckError(
        'LLM health check failed (cached)',
        this.getStatus(key, false, { message: this.cached.detail ?? 'unknown', cached: true }),
      );
    }

    const timeoutMs = this.config.get('LLM_HEALTH_TIMEOUT_MS', { infer: true });
    const ttlMs = this.config.get('LLM_HEALTH_CACHE_TTL_MS', { infer: true });
    try {
      await this.router.pingDefault(timeoutMs);
      this.cached = { healthy: true, expiresAt: now + ttlMs };
      return this.getStatus(key, true);
    } catch (err) {
      // Do not cache failures — recover as soon as the provider does.
      this.cached = undefined;
      throw new HealthCheckError(
        'LLM health check failed',
        this.getStatus(key, false, { message: (err as Error).message }),
      );
    }
  }
}
