import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import type { Env } from '@tasker/config';
import { StorageService } from '../common/storage/storage.service';

/**
 * Deep readiness probe for the object-storage backend (MinIO / S3 / R2).
 * `HeadBucket` is the cheapest reachability + auth check S3 exposes.
 * The timeout is bounded so a slow bucket cannot stall /readiness past
 * the orchestrator's own probe threshold.
 */
@Injectable()
export class StorageHealthIndicator extends HealthIndicator {
  constructor(
    private readonly storage: StorageService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const timeoutMs = this.config.get('STORAGE_HEALTH_TIMEOUT_MS', { infer: true });
    try {
      await this.storage.checkAvailability(timeoutMs);
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'Storage health check failed',
        this.getStatus(key, false, { message: (err as Error).message }),
      );
    }
  }
}
