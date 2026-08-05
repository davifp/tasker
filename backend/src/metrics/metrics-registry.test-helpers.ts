import type { ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import { MetricsRegistryService } from './metrics-registry.service';

// Test helper — spins up a MetricsRegistryService against a stubbed
// ConfigService and pre-runs onModuleInit so `build_info` and the
// default-metrics collectors are wired. Every call returns a fresh registry
// so specs don't share metric state.
export function createTestMetricsRegistry(): MetricsRegistryService {
  const cfg = {
    get: (key: string) => (key === 'RELEASE_ID' ? 'test-release' : undefined),
  } as unknown as ConfigService<Env, true>;
  const service = new MetricsRegistryService(cfg);
  service.onModuleInit();
  return service;
}
