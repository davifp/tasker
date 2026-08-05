import { describe, it, expect, beforeEach } from 'vitest';
import { RealtimeMetricsCollector } from './realtime.metrics';
import { createTestMetricsRegistry } from './metrics-registry.test-helpers';
import type { MetricsRegistryService } from './metrics-registry.service';

describe('RealtimeMetricsCollector', () => {
  let registry: MetricsRegistryService;
  let collector: RealtimeMetricsCollector;

  beforeEach(() => {
    registry = createTestMetricsRegistry();
    collector = new RealtimeMetricsCollector(registry);
  });

  async function scrape(): Promise<string> {
    return registry.render();
  }

  it('declares every realtime family (TYPE/HELP lines emitted even with no samples)', async () => {
    const out = await scrape();
    expect(out).toContain('# TYPE tasker_realtime_connections gauge');
    expect(out).toContain('# TYPE tasker_realtime_rooms gauge');
    expect(out).toContain('# TYPE tasker_realtime_events_total counter');
    expect(out).toContain('# TYPE tasker_realtime_connects_total counter');
  });

  it('tracks the connections gauge across connect/disconnect', async () => {
    collector.incrementConnect('success');
    collector.incrementConnect('success');
    collector.incrementConnect('success');
    collector.decrementConnection();
    const out = await scrape();
    expect(out).toMatch(/tasker_realtime_connections\{node="[^"]+"\} 2/);
  });

  it('rejected handshakes count but do not touch the connections gauge', async () => {
    collector.incrementConnect('reject');
    collector.incrementConnect('reject');
    const out = await scrape();
    expect(out).toMatch(/tasker_realtime_connections\{node="[^"]+"\} 0/);
    expect(out).toMatch(/tasker_realtime_connects_total\{result="reject",node="[^"]+"\} 2/);
  });

  it('never lets the connections gauge go negative when disconnects outpace connects', async () => {
    collector.decrementConnection();
    collector.decrementConnection();
    const out = await scrape();
    expect(out).toMatch(/tasker_realtime_connections\{node="[^"]+"\} 0/);
  });

  it('renders per-type/result event counters', async () => {
    collector.incrementEvent('task.updated', 'success');
    collector.incrementEvent('task.updated', 'success');
    collector.incrementEvent('task.updated', 'error');
    collector.incrementEvent('notification.new', 'dropped');
    const out = await scrape();
    expect(out).toMatch(
      /tasker_realtime_events_total\{type="task\.updated",result="success",node="[^"]+"\} 2/,
    );
    expect(out).toMatch(
      /tasker_realtime_events_total\{type="task\.updated",result="error",node="[^"]+"\} 1/,
    );
    expect(out).toMatch(
      /tasker_realtime_events_total\{type="notification\.new",result="dropped",node="[^"]+"\} 1/,
    );
  });

  it('observes rooms gauge by kind', async () => {
    collector.observeRooms('workspace', 4);
    collector.observeRooms('task', 12);
    collector.observeRooms('workspace', 5);
    const out = await scrape();
    expect(out).toMatch(/tasker_realtime_rooms\{kind="workspace",node="[^"]+"\} 5/);
    expect(out).toMatch(/tasker_realtime_rooms\{kind="task",node="[^"]+"\} 12/);
  });

  it('labels every metric with the node identifier', async () => {
    collector.incrementConnect('success');
    collector.incrementEvent('task.updated', 'success');
    const out = await scrape();
    expect(out).toMatch(/tasker_realtime_events_total\{[^}]*node="[^"]+"\}/);
    expect(out).toMatch(/tasker_realtime_connections\{node="[^"]+"\}/);
  });
});
