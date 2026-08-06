import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import { MetricsRegistryService } from '../metrics/metrics-registry.service';
import { HealthMetrics } from './health.metrics';

function bootRegistry(): MetricsRegistryService {
  const config = {
    get: (key: string) => (key === 'RELEASE_ID' ? 'test-release' : undefined),
  } as unknown as ConfigService<Env, true>;
  const registry = new MetricsRegistryService(config);
  registry.onModuleInit();
  return registry;
}

describe('HealthMetrics', () => {
  it('emits 1 for tasker_readiness_ok when every dep is up', async () => {
    const registry = bootRegistry();
    const metrics = new HealthMetrics(registry);
    metrics.record({ postgres: true, redis: true, storage: true });
    const dump = await registry.render();
    expect(dump).toMatch(/tasker_readiness_ok\s+1/);
    expect(dump).toMatch(/tasker_readiness_dep_ok\{dep="postgres"\}\s+1/);
  });

  it('emits 0 for the aggregate and the failing dep when one is down', async () => {
    const registry = bootRegistry();
    const metrics = new HealthMetrics(registry);
    metrics.record({ postgres: true, redis: false });
    const dump = await registry.render();
    expect(dump).toMatch(/tasker_readiness_ok\s+0/);
    expect(dump).toMatch(/tasker_readiness_dep_ok\{dep="redis"\}\s+0/);
    expect(dump).toMatch(/tasker_readiness_dep_ok\{dep="postgres"\}\s+1/);
  });
});
