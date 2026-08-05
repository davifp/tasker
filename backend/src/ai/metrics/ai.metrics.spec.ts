import { describe, expect, it } from 'vitest';
import { AiMetricsCollector } from './ai.metrics';
import { createTestMetricsRegistry } from '../../metrics/metrics-registry.test-helpers';

function makeCollector(): { c: AiMetricsCollector; scrape: () => Promise<string> } {
  const registry = createTestMetricsRegistry();
  return { c: new AiMetricsCollector(registry), scrape: () => registry.render() };
}

describe('AiMetricsCollector', () => {
  it('renders the six documented metric families with the spec label sets', async () => {
    const { c, scrape } = makeCollector();
    c.incrementInvocation('GENERATE_DESCRIPTION', 'anthropic', 'claude-sonnet-4-6', 'OK');
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'input', 1200);
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'output', 350);
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'cached_input', 800);
    c.observeLatency('GENERATE_DESCRIPTION', 'anthropic', 1450);
    c.setBudgetRatio('ws-1', 0.62);
    c.incrementFallback('anthropic', 'openai', 'overloaded');
    c.incrementFeedback('SUMMARIZE_COMMENTS', 'POSITIVE');

    const out = await scrape();

    expect(out).toContain('# TYPE tasker_ai_invocations_total counter');
    expect(out).toContain('# TYPE tasker_ai_tokens_total counter');
    expect(out).toContain('# TYPE tasker_ai_latency_ms histogram');
    expect(out).toContain('# TYPE tasker_ai_budget_ratio gauge');
    expect(out).toContain('# TYPE tasker_ai_provider_fallbacks_total counter');
    expect(out).toContain('# TYPE tasker_ai_feedback_total counter');

    expect(out).toContain(
      'tasker_ai_invocations_total{action="GENERATE_DESCRIPTION",provider="anthropic",model="claude-sonnet-4-6",status="OK"} 1',
    );
    expect(out).toContain(
      'tasker_ai_tokens_total{action="GENERATE_DESCRIPTION",provider="anthropic",kind="input"} 1200',
    );
    expect(out).toContain('tasker_ai_budget_ratio{workspaceId="ws-1"} 0.62');
    expect(out).toContain(
      'tasker_ai_provider_fallbacks_total{from="anthropic",to="openai",reason="overloaded"} 1',
    );
    expect(out).toContain(
      'tasker_ai_feedback_total{action="SUMMARIZE_COMMENTS",rating="POSITIVE"} 1',
    );
  });

  it('places the latency observation in every bucket at or above its value + records the +Inf sentinel', async () => {
    const { c, scrape } = makeCollector();
    c.observeLatency('GENERATE_CHECKLIST', 'openai', 1200); // >1000, ≤2000
    const out = await scrape();

    expect(out).toContain(
      'tasker_ai_latency_ms_bucket{le="1000",action="GENERATE_CHECKLIST",provider="openai"} 0',
    );
    expect(out).toContain(
      'tasker_ai_latency_ms_bucket{le="2000",action="GENERATE_CHECKLIST",provider="openai"} 1',
    );
    expect(out).toContain(
      'tasker_ai_latency_ms_bucket{le="+Inf",action="GENERATE_CHECKLIST",provider="openai"} 1',
    );
    expect(out).toContain(
      'tasker_ai_latency_ms_sum{action="GENERATE_CHECKLIST",provider="openai"} 1200',
    );
    expect(out).toContain(
      'tasker_ai_latency_ms_count{action="GENERATE_CHECKLIST",provider="openai"} 1',
    );
  });

  it('ignores non-positive token counts', async () => {
    const { c, scrape } = makeCollector();
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'input', 0);
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'input', -5);
    const out = await scrape();
    expect(out).not.toMatch(
      /tasker_ai_tokens_total\{action="GENERATE_DESCRIPTION",provider="anthropic",kind="input"\} \d/,
    );
  });

  it('clamps budget ratio to [0, 2] so a runaway reconcile does not break rendering', async () => {
    const { c, scrape } = makeCollector();
    c.setBudgetRatio('ws-a', -0.1);
    c.setBudgetRatio('ws-b', 3.5);
    const out = await scrape();
    expect(out).toContain('tasker_ai_budget_ratio{workspaceId="ws-a"} 0');
    expect(out).toContain('tasker_ai_budget_ratio{workspaceId="ws-b"} 2');
  });

  it('label cardinality: no free-text labels are emitted', async () => {
    const { c, scrape } = makeCollector();
    c.incrementInvocation('GENERATE_DESCRIPTION', 'anthropic', 'claude-sonnet-4-6', 'OK');
    const out = await scrape();
    expect(out).not.toMatch(/taskTitle=/);
    expect(out).not.toMatch(/workspaceName=/);
    expect(out).not.toMatch(/prompt=/);
  });
});
