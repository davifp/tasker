import { Injectable } from '@nestjs/common';
import * as os from 'node:os';
import type { Counter, Gauge } from 'prom-client';
import { MetricsRegistryService } from './metrics-registry.service';

// Socket.IO / realtime metrics. Node label is the local hostname so
// multi-node deployments can graph per-instance connections without a service
// discovery layer.
@Injectable()
export class RealtimeMetricsCollector {
  private readonly nodeLabel: string;
  private readonly connectionsGauge: Gauge<'node'>;
  private readonly roomsGauge: Gauge<'kind' | 'node'>;
  private readonly eventsTotal: Counter<'type' | 'result' | 'node'>;
  private readonly connectsTotal: Counter<'result' | 'node'>;
  // Mirror of the gauge value used only for the non-negative clamp on decrement.
  // Kept in sync with every inc/dec/set call so the guard doesn't need to await
  // prom-client's async `get()`.
  private connectionCount = 0;

  constructor(registry: MetricsRegistryService) {
    this.nodeLabel = process.env.HOSTNAME || os.hostname();

    this.connectionsGauge = registry.gauge({
      name: 'tasker_realtime_connections',
      help: 'Active socket.io connections.',
      labelNames: ['node'] as const,
    });
    this.roomsGauge = registry.gauge({
      name: 'tasker_realtime_rooms',
      help: 'Active socket.io rooms by kind.',
      labelNames: ['kind', 'node'] as const,
    });
    this.eventsTotal = registry.counter({
      name: 'tasker_realtime_events_total',
      help: 'Realtime events emitted.',
      labelNames: ['type', 'result', 'node'] as const,
    });
    this.connectsTotal = registry.counter({
      name: 'tasker_realtime_connects_total',
      help: 'Socket.io handshake attempts.',
      labelNames: ['result', 'node'] as const,
    });

    // Seed the gauge so `/metrics` returns a well-formed sample even before
    // the first connection lands.
    this.connectionsGauge.set({ node: this.nodeLabel }, 0);
  }

  incrementConnect(result: 'success' | 'reject'): void {
    this.connectsTotal.inc({ result, node: this.nodeLabel });
    if (result === 'success') {
      this.connectionCount += 1;
      this.connectionsGauge.set({ node: this.nodeLabel }, this.connectionCount);
    }
  }

  decrementConnection(): void {
    // Guard against going negative — a disconnect can arrive after the app
    // restarted (gauge freshly zero) or after a doubled cleanup path fires
    // twice. Prom-client would happily emit -1 otherwise.
    if (this.connectionCount <= 0) return;
    this.connectionCount -= 1;
    this.connectionsGauge.set({ node: this.nodeLabel }, this.connectionCount);
  }

  observeRooms(kind: 'workspace' | 'task' | 'user', count: number): void {
    this.roomsGauge.set({ kind, node: this.nodeLabel }, count);
  }

  incrementEvent(type: string, result: 'success' | 'error' | 'dropped'): void {
    this.eventsTotal.inc({ type, result, node: this.nodeLabel });
  }
}
