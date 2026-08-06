import { describe, expect, it, vi } from 'vitest';
import { HealthCheckError } from '@nestjs/terminus';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import { StorageHealthIndicator } from './storage.health';
import type { StorageService } from '../common/storage/storage.service';

function makeConfig(timeoutMs = 500): ConfigService<Env, true> {
  return { get: () => timeoutMs } as unknown as ConfigService<Env, true>;
}

function makeStorage(check: () => Promise<void>): StorageService {
  return {
    signPutUrl: vi.fn(),
    signGetUrl: vi.fn(),
    scheduleDelete: vi.fn(),
    checkAvailability: vi.fn(check),
  } as unknown as StorageService;
}

describe('StorageHealthIndicator', () => {
  it('reports up when the bucket is reachable', async () => {
    const indicator = new StorageHealthIndicator(
      makeStorage(() => Promise.resolve()),
      makeConfig(),
    );
    const result = await indicator.isHealthy('storage');
    expect(result['storage']?.status).toBe('up');
  });

  it('reports down and wraps the error when HeadBucket fails', async () => {
    const indicator = new StorageHealthIndicator(
      makeStorage(() => Promise.reject(new Error('AccessDenied'))),
      makeConfig(),
    );
    await expect(indicator.isHealthy('storage')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('propagates the configured timeout to the adapter', async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const indicator = new StorageHealthIndicator(makeStorage(check), makeConfig(1234));
    await indicator.isHealthy('storage');
    expect(check).toHaveBeenCalledWith(1234);
  });
});
