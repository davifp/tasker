import { describe, expect, it } from 'vitest';
import { AiMetricsCollector } from './ai.metrics';

describe('AiMetricsCollector', () => {
  it('renders the six documented metric families with the spec label sets', () => {
    const c = new AiMetricsCollector();
    c.incrementInvocation('GENERATE_DESCRIPTION', 'anthropic', 'claude-sonnet-4-6', 'OK');
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'input', 1200);
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'output', 350);
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'cached_input', 800);
    c.observeLatency('GENERATE_DESCRIPTION', 'anthropic', 1450);
    c.setBudgetRatio('ws-1', 0.62);
    c.incrementFallback('anthropic', 'openai', 'overloaded');
    c.incrementFeedback('SUMMARIZE_COMMENTS', 'POSITIVE');

    const out = c.render();

    // Metric names — all six families present.
    expect(out).toContain('tasker_ai_invocations_total');
    expect(out).toContain('tasker_ai_tokens_total');
    expect(out).toContain('tasker_ai_latency_ms_bucket');
    expect(out).toContain('tasker_ai_latency_ms_sum');
    expect(out).toContain('tasker_ai_latency_ms_count');
    expect(out).toContain('tasker_ai_budget_ratio');
    expect(out).toContain('tasker_ai_provider_fallbacks_total');
    expect(out).toContain('tasker_ai_feedback_total');

    // Sample lines with all documented labels.
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

  it('places the latency observation in every bucket above its value + records the +Inf sentinel', () => {
    const c = new AiMetricsCollector();
    c.observeLatency('GENERATE_CHECKLIST', 'openai', 1200); // >1000, ≤2000
    const out = c.render();

    // Bucket 1000 excludes, 2000/3000/5000/10000 include; +Inf and count always include.
    expect(out).toContain(
      'tasker_ai_latency_ms_bucket{action="GENERATE_CHECKLIST",provider="openai",le="1000"} 0',
    );
    expect(out).toContain(
      'tasker_ai_latency_ms_bucket{action="GENERATE_CHECKLIST",provider="openai",le="2000"} 1',
    );
    expect(out).toContain(
      'tasker_ai_latency_ms_bucket{action="GENERATE_CHECKLIST",provider="openai",le="+Inf"} 1',
    );
    expect(out).toContain(
      'tasker_ai_latency_ms_sum{action="GENERATE_CHECKLIST",provider="openai"} 1200',
    );
    expect(out).toContain(
      'tasker_ai_latency_ms_count{action="GENERATE_CHECKLIST",provider="openai"} 1',
    );
  });

  it('ignores non-positive token counts', () => {
    const c = new AiMetricsCollector();
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'input', 0);
    c.addTokens('GENERATE_DESCRIPTION', 'anthropic', 'input', -5);
    const out = c.render();
    expect(out).not.toContain(
      'tasker_ai_tokens_total{action="GENERATE_DESCRIPTION",provider="anthropic",kind="input"}',
    );
  });

  it('clamps budget ratio to [0, 2] so a runaway reconcile does not break rendering', () => {
    const c = new AiMetricsCollector();
    c.setBudgetRatio('ws-a', -0.1);
    c.setBudgetRatio('ws-b', 3.5);
    const out = c.render();
    expect(out).toContain('tasker_ai_budget_ratio{workspaceId="ws-a"} 0');
    expect(out).toContain('tasker_ai_budget_ratio{workspaceId="ws-b"} 2');
  });

  it('label cardinality: no free-text labels are emitted', () => {
    const c = new AiMetricsCollector();
    c.incrementInvocation('GENERATE_DESCRIPTION', 'anthropic', 'claude-sonnet-4-6', 'OK');
    const out = c.render();
    // No obvious user-content labels — sanity check to catch a future
    // refactor that "helpfully" adds workspace name / task title as a label.
    expect(out).not.toMatch(/taskTitle=/);
    expect(out).not.toMatch(/workspaceName=/);
    expect(out).not.toMatch(/prompt=/);
  });
});
