import { Injectable } from '@nestjs/common';
import * as os from 'node:os';

// Follows the same in-house collector shape as `SearchAuditMetricsCollector`.
// Node label is the local hostname so multi-node deployments can graph
// per-instance connections without a service discovery layer.
@Injectable()
export class RealtimeMetricsCollector {
  private readonly nodeLabel: string;
  private connectionsGauge = 0;
  private readonly roomsGauge = new Map<string, number>(); // kind -> count
  private readonly eventsTotal = new Map<string, number>(); // type|result -> count
  private readonly connectsTotal = new Map<string, number>(); // result -> count

  constructor() {
    this.nodeLabel = process.env.HOSTNAME || os.hostname();
  }

  // ---- Mutators ----

  incrementConnect(result: 'success' | 'reject'): void {
    this.connectsTotal.set(result, (this.connectsTotal.get(result) ?? 0) + 1);
    if (result === 'success') this.connectionsGauge++;
  }

  decrementConnection(): void {
    if (this.connectionsGauge > 0) this.connectionsGauge--;
  }

  observeRooms(kind: 'workspace' | 'task' | 'user', count: number): void {
    this.roomsGauge.set(kind, count);
  }

  incrementEvent(type: string, result: 'success' | 'error' | 'dropped'): void {
    const key = `${type}|${result}`;
    this.eventsTotal.set(key, (this.eventsTotal.get(key) ?? 0) + 1);
  }

  // ---- Render ----

  render(): string {
    const lines: string[] = [];

    lines.push('# HELP tasker_realtime_connections Active socket.io connections.');
    lines.push('# TYPE tasker_realtime_connections gauge');
    lines.push(`tasker_realtime_connections{node="${this.nodeLabel}"} ${this.connectionsGauge}`);

    lines.push('# HELP tasker_realtime_rooms Active socket.io rooms by kind.');
    lines.push('# TYPE tasker_realtime_rooms gauge');
    for (const [kind, count] of this.roomsGauge) {
      lines.push(`tasker_realtime_rooms{kind="${kind}",node="${this.nodeLabel}"} ${count}`);
    }

    lines.push('# HELP tasker_realtime_events_total Realtime events emitted.');
    lines.push('# TYPE tasker_realtime_events_total counter');
    for (const [key, value] of this.eventsTotal) {
      const [type, result] = key.split('|');
      lines.push(
        `tasker_realtime_events_total{type="${type}",result="${result}",node="${this.nodeLabel}"} ${value}`,
      );
    }

    lines.push('# HELP tasker_realtime_connects_total Socket.io handshake attempts.');
    lines.push('# TYPE tasker_realtime_connects_total counter');
    for (const [result, value] of this.connectsTotal) {
      lines.push(
        `tasker_realtime_connects_total{result="${result}",node="${this.nodeLabel}"} ${value}`,
      );
    }

    return lines.join('\n') + '\n';
  }

  snapshot() {
    return {
      connectionsGauge: this.connectionsGauge,
      roomsGauge: Object.fromEntries(this.roomsGauge),
      eventsTotal: Object.fromEntries(this.eventsTotal),
      connectsTotal: Object.fromEntries(this.connectsTotal),
    };
  }
}
