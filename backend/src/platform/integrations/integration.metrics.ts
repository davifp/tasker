import { Injectable } from '@nestjs/common';
import type { Counter } from 'prom-client';
import type { IntegrationProvider } from '@prisma/client';
import { MetricsRegistryService } from '../../metrics/metrics-registry.service';

type Outcome = 'success' | 'unauthorized' | 'timeout' | 'error';

@Injectable()
export class IntegrationMetricsCollector {
  private readonly syncsTotal: Counter<'provider' | 'outcome'>;
  private readonly connectionsTotal: Counter<'provider' | 'outcome'>;

  constructor(registry: MetricsRegistryService) {
    this.syncsTotal = registry.counter({
      name: 'platform_integration_syncs_total',
      help: 'Outbound integration sync attempts.',
      labelNames: ['provider', 'outcome'] as const,
    });
    this.connectionsTotal = registry.counter({
      name: 'platform_integration_connections_total',
      help: 'Integration lifecycle events.',
      labelNames: ['provider', 'outcome'] as const,
    });
  }

  incrementSync(provider: IntegrationProvider, outcome: Outcome): void {
    this.syncsTotal.inc({ provider, outcome });
  }

  incrementConnection(provider: IntegrationProvider, outcome: 'connected' | 'disconnected'): void {
    this.connectionsTotal.inc({ provider, outcome });
  }
}
