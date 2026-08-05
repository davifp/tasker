import { Injectable } from '@nestjs/common';
import type { IntegrationProvider } from '@prisma/client';

type Outcome = 'success' | 'unauthorized' | 'timeout' | 'error';

@Injectable()
export class IntegrationMetricsCollector {
  private readonly syncsTotal = new Map<string, number>();
  private readonly connectionsTotal = new Map<string, number>();

  incrementSync(provider: IntegrationProvider, outcome: Outcome): void {
    const label = `${provider}|${outcome}`;
    this.syncsTotal.set(label, (this.syncsTotal.get(label) ?? 0) + 1);
  }

  incrementConnection(provider: IntegrationProvider, outcome: 'connected' | 'disconnected'): void {
    const label = `${provider}|${outcome}`;
    this.connectionsTotal.set(label, (this.connectionsTotal.get(label) ?? 0) + 1);
  }

  render(): string {
    const lines: string[] = [];

    lines.push('# HELP platform_integration_syncs_total Outbound integration sync attempts.');
    lines.push('# TYPE platform_integration_syncs_total counter');
    for (const [label, value] of this.syncsTotal) {
      const [provider, outcome] = label.split('|');
      lines.push(
        `platform_integration_syncs_total{provider="${provider}",outcome="${outcome}"} ${value}`,
      );
    }

    lines.push('# HELP platform_integration_connections_total Integration lifecycle events.');
    lines.push('# TYPE platform_integration_connections_total counter');
    for (const [label, value] of this.connectionsTotal) {
      const [provider, outcome] = label.split('|');
      lines.push(
        `platform_integration_connections_total{provider="${provider}",outcome="${outcome}"} ${value}`,
      );
    }

    return lines.join('\n') + '\n';
  }

  snapshot() {
    return {
      syncsTotal: Object.fromEntries(this.syncsTotal),
      connectionsTotal: Object.fromEntries(this.connectionsTotal),
    };
  }
}
