import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { AuditEvent } from '../../common/audit/audit.events';
import { TraceContext } from '../../common/trace/trace-context';
import { AiMetricsCollector } from '../metrics/ai.metrics';
import { createTestMetricsRegistry } from '../../metrics/metrics-registry.test-helpers';
import { AiInvocationRecorder } from './ai-invocation.recorder';

function makeRecorder() {
  const create = vi.fn().mockResolvedValue({ id: 'inv-1' });
  const prisma = {
    forSystem: () => ({ aiInvocation: { create } }),
  } as never;
  const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const registry = createTestMetricsRegistry();
  const metrics = new AiMetricsCollector(registry);
  const recorder = new AiInvocationRecorder(prisma, audit, metrics);
  return { recorder, create, audit, metrics, registry };
}

describe('AiInvocationRecorder', () => {
  it('writes AiInvocation and AuditLog with the same traceId', async () => {
    const { recorder, create, audit } = makeRecorder();
    await TraceContext.run('trace-abc', async () => {
      const out = await recorder.record({
        workspaceId: 'ws-1',
        actorUserId: 'user-1',
        action: 'GENERATE_DESCRIPTION',
        targetType: 'task',
        targetId: 'task-1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 20,
        latencyMs: 1200,
        status: 'OK',
      });
      expect(out.invocationId).toBe('inv-1');
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          actorUserId: 'user-1',
          action: 'GENERATE_DESCRIPTION',
          traceId: 'trace-abc',
          status: 'OK',
          model: 'claude-sonnet-4-6',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AuditEvent.AI_INVOCATION,
        actorUserId: 'user-1',
        workspaceId: 'ws-1',
        targetType: 'task',
        targetId: 'task-1',
        metadata: expect.objectContaining({
          ai: expect.objectContaining({
            action: 'GENERATE_DESCRIPTION',
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            inputTokens: 100,
            outputTokens: 50,
            cachedInputTokens: 20,
            latencyMs: 1200,
            status: 'OK',
          }),
        }),
      }),
    );
  });

  it('bumps invocations_total, tokens_total, and latency_ms via the metrics collector', async () => {
    const { recorder, registry } = makeRecorder();
    await recorder.record({
      workspaceId: 'ws-1',
      actorUserId: 'user-1',
      action: 'ESTIMATE_AND_SUGGEST',
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 200,
      outputTokens: 60,
      cachedInputTokens: 0,
      latencyMs: 800,
      status: 'OK',
    });
    const out = await registry.render();
    expect(out).toContain(
      'tasker_ai_invocations_total{action="ESTIMATE_AND_SUGGEST",provider="openai",model="gpt-4o-mini",status="OK"} 1',
    );
    expect(out).toContain(
      'tasker_ai_tokens_total{action="ESTIMATE_AND_SUGGEST",provider="openai",kind="input"} 200',
    );
    expect(out).toContain(
      'tasker_ai_latency_ms_sum{action="ESTIMATE_AND_SUGGEST",provider="openai"} 800',
    );
  });

  it('counts a fallback via tasker_ai_provider_fallbacks_total{from,to,reason}', async () => {
    const { recorder, registry } = makeRecorder();
    await recorder.record({
      workspaceId: 'ws-1',
      actorUserId: 'user-1',
      action: 'GENERATE_DESCRIPTION',
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0,
      latencyMs: 500,
      status: 'OK',
      fallback: { from: 'anthropic', reason: 'overloaded' },
    });
    expect(await registry.render()).toContain(
      'tasker_ai_provider_fallbacks_total{from="anthropic",to="openai",reason="overloaded"} 1',
    );
  });

  it('errors persist a row with status=ERROR + errorCode; observability is fire-and-forget', async () => {
    const { recorder, create, audit } = makeRecorder();
    await recorder.record({
      workspaceId: 'ws-1',
      actorUserId: 'user-1',
      action: 'GENERATE_CHECKLIST',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      latencyMs: 320,
      status: 'ERROR',
      errorCode: 'ai-provider-unavailable',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ERROR', errorCode: 'ai-provider-unavailable' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ai: expect.objectContaining({
            status: 'ERROR',
            errorCode: 'ai-provider-unavailable',
          }),
        }),
      }),
    );
  });

  it('does not throw if the AiInvocation write fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const prisma = { forSystem: () => ({ aiInvocation: { create } }) } as never;
    const audit = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const registry = createTestMetricsRegistry();
    const metrics = new AiMetricsCollector(registry);
    const recorder = new AiInvocationRecorder(prisma, audit, metrics);

    await expect(
      recorder.record({
        workspaceId: 'ws-1',
        actorUserId: 'user-1',
        action: 'GENERATE_DESCRIPTION',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
        latencyMs: 1,
        status: 'OK',
      }),
    ).resolves.toBeDefined();
    // Audit + metrics still fired.
    expect(audit.record).toHaveBeenCalled();
    expect(await registry.render()).toContain('tasker_ai_invocations_total');
  });
});
