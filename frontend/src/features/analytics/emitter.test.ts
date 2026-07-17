import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalyticsEventSchema, createAnalyticsClient, type AnalyticsBatch } from './emitter';

describe('AnalyticsEventSchema', () => {
  it('accepts every documented shape', () => {
    const events = [
      { name: 'signup_started', provider: 'google' },
      { name: 'workspace_created', workspaceId: 'ws-1' },
      { name: 'invite_sent', workspaceId: 'ws-1', count: 5 },
    ] as const;
    for (const event of events) {
      expect(AnalyticsEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('rejects unknown provider values', () => {
    expect(
      AnalyticsEventSchema.safeParse({ name: 'login_completed', provider: 'twitter' }).success,
    ).toBe(false);
  });

  it('caps invite_sent count at 10', () => {
    expect(
      AnalyticsEventSchema.safeParse({ name: 'invite_sent', workspaceId: 'ws-1', count: 11 })
        .success,
    ).toBe(false);
  });
});

describe('analytics client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('batches events after the flush interval', async () => {
    const sent: AnalyticsBatch[] = [];
    const client = createAnalyticsClient({
      flushIntervalMs: 100,
      post: async (batch) => {
        sent.push(batch);
      },
    });
    client.emit({ name: 'signup_started', provider: 'local' });
    client.emit({ name: 'signup_completed', provider: 'local' });

    await vi.advanceTimersByTimeAsync(150);
    await client.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.events.map((event) => event.name)).toEqual([
      'signup_started',
      'signup_completed',
    ]);
  });

  it('flushes immediately when the batch size is reached', async () => {
    const sent: AnalyticsBatch[] = [];
    const client = createAnalyticsClient({
      batchSize: 2,
      flushIntervalMs: 5000,
      post: async (batch) => {
        sent.push(batch);
      },
    });
    client.emit({ name: 'signup_started', provider: 'local' });
    client.emit({ name: 'signup_completed', provider: 'local' });
    await vi.runOnlyPendingTimersAsync();
    await client.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.events).toHaveLength(2);
  });

  it('retries transient network failures up to maxRetries', async () => {
    let calls = 0;
    const client = createAnalyticsClient({
      flushIntervalMs: 10,
      maxRetries: 2,
      post: async () => {
        calls += 1;
        if (calls < 3) throw new Error('network');
      },
    });
    client.emit({ name: 'login_completed', provider: 'github' });
    await vi.advanceTimersByTimeAsync(20);
    await client.flush();

    expect(calls).toBe(3);
  });

  it('never carries PII beyond userId and workspaceId at the schema level', () => {
    // The schema itself constrains the payload — verify no arbitrary key sneaks in.
    const parsed = AnalyticsEventSchema.safeParse({
      name: 'workspace_created',
      workspaceId: 'ws-1',
      email: 'ada@example.com',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('email' in parsed.data).toBe(false);
    }
  });
});
