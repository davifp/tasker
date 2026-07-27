import { describe, it, expect, beforeEach } from 'vitest';
import { RealtimeMetricsCollector } from './realtime.metrics';

describe('RealtimeMetricsCollector', () => {
  let collector: RealtimeMetricsCollector;

  beforeEach(() => {
    collector = new RealtimeMetricsCollector();
  });

  it('renders empty scrape output with all metric families declared', () => {
    const out = collector.render();
    expect(out).toContain('tasker_realtime_connections');
    expect(out).toContain('tasker_realtime_rooms');
    expect(out).toContain('tasker_realtime_events_total');
    expect(out).toContain('tasker_realtime_connects_total');
  });

  it('tracks the connections gauge across connect/disconnect', () => {
    collector.incrementConnect('success');
    collector.incrementConnect('success');
    collector.incrementConnect('success');
    collector.decrementConnection();
    expect(collector.snapshot().connectionsGauge).toBe(2);
  });

  it('rejected handshakes count but do not touch the connections gauge', () => {
    collector.incrementConnect('reject');
    collector.incrementConnect('reject');
    expect(collector.snapshot().connectionsGauge).toBe(0);
    expect(collector.snapshot().connectsTotal).toEqual({ reject: 2 });
  });

  it('never lets the connections gauge go negative when disconnects outpace connects', () => {
    collector.decrementConnection();
    collector.decrementConnection();
    expect(collector.snapshot().connectionsGauge).toBe(0);
  });

  it('renders per-type/result event counters', () => {
    collector.incrementEvent('task.updated', 'success');
    collector.incrementEvent('task.updated', 'success');
    collector.incrementEvent('task.updated', 'error');
    collector.incrementEvent('notification.new', 'dropped');
    const out = collector.render();
    expect(out).toMatch(
      /tasker_realtime_events_total\{type="task\.updated",result="success",[^}]*\} 2/,
    );
    expect(out).toMatch(
      /tasker_realtime_events_total\{type="task\.updated",result="error",[^}]*\} 1/,
    );
    expect(out).toMatch(
      /tasker_realtime_events_total\{type="notification\.new",result="dropped",[^}]*\} 1/,
    );
  });

  it('observes rooms gauge by kind', () => {
    collector.observeRooms('workspace', 4);
    collector.observeRooms('task', 12);
    collector.observeRooms('workspace', 5);
    const snap = collector.snapshot();
    expect(snap.roomsGauge).toEqual({ workspace: 5, task: 12 });
    const out = collector.render();
    expect(out).toMatch(/tasker_realtime_rooms\{kind="workspace",[^}]*\} 5/);
    expect(out).toMatch(/tasker_realtime_rooms\{kind="task",[^}]*\} 12/);
  });

  it('labels every metric with the node identifier', () => {
    collector.incrementConnect('success');
    collector.incrementEvent('task.updated', 'success');
    const out = collector.render();
    expect(out).toMatch(/node="[^"]+"/);
  });
});
