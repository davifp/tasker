import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthCheckError } from '@nestjs/terminus';
import { BullMqHealthIndicator } from './bullmq.health';

function makeQueue(counts: {
  waiting?: number;
  active?: number;
  delayed?: number;
  failed?: number;
  paused?: boolean;
}) {
  return {
    getJobCounts: vi.fn().mockResolvedValue({
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
    }),
    isPaused: vi.fn().mockResolvedValue(counts.paused ?? false),
  };
}

const configForThresholds = (maxWaiting = 1000) => ({
  get: vi.fn((key: string, def: unknown) => {
    if (key === 'BULLMQ_HEALTH_MAX_WAITING') return maxWaiting;
    return def;
  }),
});

describe('BullMqHealthIndicator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns UP when both queues are within thresholds and unpaused', async () => {
    const indicator = new BullMqHealthIndicator(
      makeQueue({ waiting: 3 }) as never,
      makeQueue({ waiting: 0 }) as never,
      configForThresholds() as never,
    );

    const result = await indicator.isHealthy('bullmq');
    expect(result.bullmq?.status).toBe('up');
  });

  it('throws HealthCheckError when a queue is paused', async () => {
    const indicator = new BullMqHealthIndicator(
      makeQueue({ paused: true }) as never,
      makeQueue({}) as never,
      configForThresholds() as never,
    );

    await expect(indicator.isHealthy('bullmq')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('throws HealthCheckError when waiting exceeds threshold', async () => {
    const indicator = new BullMqHealthIndicator(
      makeQueue({}) as never,
      makeQueue({ waiting: 500 }) as never,
      configForThresholds(100) as never,
    );

    await expect(indicator.isHealthy('bullmq')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('fails fast with HealthCheckError when queue introspection hangs (Redis down)', async () => {
    const hanging = {
      getJobCounts: vi.fn(() => new Promise(() => {})),
      isPaused: vi.fn(() => new Promise(() => {})),
    };
    const indicator = new BullMqHealthIndicator(
      hanging as never,
      hanging as never,
      {
        get: vi.fn((key: string, def: unknown) => {
          if (key === 'BULLMQ_HEALTH_TIMEOUT_MS') return 20;
          return def;
        }),
      } as never,
    );

    await expect(indicator.isHealthy('bullmq')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('includes a human-readable detail on the failing result', async () => {
    const indicator = new BullMqHealthIndicator(
      makeQueue({ paused: true }) as never,
      makeQueue({}) as never,
      configForThresholds() as never,
    );

    try {
      await indicator.isHealthy('bullmq');
      expect.fail('expected HealthCheckError');
    } catch (err) {
      const causes = (err as HealthCheckError).causes as { bullmq: { detail: string } };
      expect(causes.bullmq.detail).toContain('mail queue is paused');
    }
  });
});
