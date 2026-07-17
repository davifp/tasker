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

  it('rejects payloads that smuggle extra keys (PII guard)', () => {
    // With `.strict()`, an unknown key (e.g. `email`) fails parsing rather
    // than being silently stripped — the contract is explicit, not lax.
    const parsed = AnalyticsEventSchema.safeParse({
      name: 'workspace_created',
      workspaceId: 'ws-1',
      email: 'ada@example.com',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('AnalyticsEventSchema — Phase 3 variants', () => {
  it('accepts project_created / task_created / task_completed / comment_added', () => {
    const events = [
      { name: 'project_created', workspaceId: 'ws-1', projectId: 'p-1' },
      { name: 'task_created', workspaceId: 'ws-1', projectId: 'p-1', taskId: 't-1' },
      { name: 'task_completed', workspaceId: 'ws-1', projectId: 'p-1', taskId: 't-1' },
      {
        name: 'comment_added',
        workspaceId: 'ws-1',
        projectId: 'p-1',
        taskId: 't-1',
        commentId: 'c-1',
      },
    ] as const;
    for (const event of events) {
      expect(AnalyticsEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('accepts task_moved with fromStatus/toStatus and rejects invalid enum values', () => {
    expect(
      AnalyticsEventSchema.safeParse({
        name: 'task_moved',
        workspaceId: 'ws-1',
        projectId: 'p-1',
        taskId: 't-1',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'DONE',
      }).success,
    ).toBe(true);

    expect(
      AnalyticsEventSchema.safeParse({
        name: 'task_moved',
        workspaceId: 'ws-1',
        projectId: 'p-1',
        taskId: 't-1',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'ARCHIVED',
      }).success,
    ).toBe(false);
  });

  it('rejects a task_created payload that carries an email PII field', () => {
    expect(
      AnalyticsEventSchema.safeParse({
        name: 'task_created',
        workspaceId: 'ws-1',
        projectId: 'p-1',
        taskId: 't-1',
        email: 'ada@example.com',
      }).success,
    ).toBe(false);
  });
});
