import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthCheckError } from '@nestjs/terminus';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import { LlmHealthIndicator } from './llm.health';
import type { LlmRouter } from '../ai/providers/llm-router';

function makeConfig({
  timeoutMs = 500,
  ttlMs = 60_000,
}: {
  timeoutMs?: number;
  ttlMs?: number;
} = {}): ConfigService<Env, true> {
  return {
    get: (key: string) => (key === 'LLM_HEALTH_CACHE_TTL_MS' ? ttlMs : timeoutMs),
  } as unknown as ConfigService<Env, true>;
}

function makeRouter(ping: () => Promise<void>): LlmRouter {
  return { pingDefault: vi.fn(ping) } as unknown as LlmRouter;
}

describe('LlmHealthIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('reports up when the provider responds', async () => {
    const indicator = new LlmHealthIndicator(
      makeRouter(() => Promise.resolve()),
      makeConfig(),
    );
    const result = await indicator.isHealthy('llm');
    expect(result['llm']?.status).toBe('up');
  });

  it('reports down when the provider throws', async () => {
    const indicator = new LlmHealthIndicator(
      makeRouter(() => Promise.reject(new Error('timeout'))),
      makeConfig(),
    );
    await expect(indicator.isHealthy('llm')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('caches positive results for the configured TTL', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const indicator = new LlmHealthIndicator(
      { pingDefault: ping } as unknown as LlmRouter,
      makeConfig({ ttlMs: 60_000 }),
    );

    await indicator.isHealthy('llm');
    await indicator.isHealthy('llm');
    await indicator.isHealthy('llm');
    expect(ping).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 61_000);
    await indicator.isHealthy('llm');
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures — probes the provider again after an error', async () => {
    const ping = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const indicator = new LlmHealthIndicator(
      { pingDefault: ping } as unknown as LlmRouter,
      makeConfig(),
    );

    await expect(indicator.isHealthy('llm')).rejects.toBeInstanceOf(HealthCheckError);
    const ok = await indicator.isHealthy('llm');
    expect(ok['llm']?.status).toBe('up');
    expect(ping).toHaveBeenCalledTimes(2);
  });
});
