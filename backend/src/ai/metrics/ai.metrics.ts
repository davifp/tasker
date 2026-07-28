import { Injectable } from '@nestjs/common';
import type { AiAction, AiFeedbackRating, AiInvocationStatus } from '@prisma/client';
import type { LlmProviderName } from '../providers/llm-provider.port';

const LATENCY_BUCKETS_MS = [100, 250, 500, 1000, 2000, 3000, 5000, 10000] as const;

/**
 * In-memory Prometheus renderer for AI actions — mirrors the shape used by
 * `RealtimeMetricsCollector`/`NotificationsMetricsCollector` so operators
 * scrape one `/metrics` endpoint and see every subsystem side by side.
 *
 * Label cardinality budget:
 *
 *  - `action` — 4 values (enum).
 *  - `provider` — 2 values (`anthropic`, `openai`).
 *  - `model` — capped small set; adapters keep this to their default per
 *    action, so cardinality tracks provider version, not workspaces.
 *  - `status` — 3 values (enum).
 *  - `rating` — 2 values (enum).
 *  - `workspaceId` (only on `tasker_ai_budget_ratio`) — grows with tenants;
 *    the tech spec accepts this because the gauge is the primary signal for
 *    per-workspace budget dashboards. If cardinality becomes a scrape
 *    problem, downstream Prometheus recording rules can aggregate.
 *
 * Never label with free-text (task titles, prompts, comment excerpts).
 */
@Injectable()
export class AiMetricsCollector {
  private readonly invocationsTotal = new Map<string, number>();
  private readonly tokensTotal = new Map<string, number>();
  private readonly latencyBuckets = new Map<string, number[]>();
  private readonly latencySums = new Map<string, number>();
  private readonly latencyCounts = new Map<string, number>();
  private readonly budgetRatio = new Map<string, number>();
  private readonly fallbacksTotal = new Map<string, number>();
  private readonly feedbackTotal = new Map<string, number>();

  incrementInvocation(
    action: AiAction,
    provider: LlmProviderName,
    model: string,
    status: AiInvocationStatus,
  ): void {
    const key = `${action}|${provider}|${model}|${status}`;
    this.invocationsTotal.set(key, (this.invocationsTotal.get(key) ?? 0) + 1);
  }

  addTokens(
    action: AiAction,
    provider: LlmProviderName,
    kind: 'input' | 'output' | 'cached_input',
    count: number,
  ): void {
    if (count <= 0) return;
    const key = `${action}|${provider}|${kind}`;
    this.tokensTotal.set(key, (this.tokensTotal.get(key) ?? 0) + count);
  }

  observeLatency(action: AiAction, provider: LlmProviderName, latencyMs: number): void {
    const key = `${action}|${provider}`;
    const buckets =
      this.latencyBuckets.get(key) ?? new Array<number>(LATENCY_BUCKETS_MS.length).fill(0);
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i += 1) {
      const bucketCeil = LATENCY_BUCKETS_MS[i]!;
      if (latencyMs <= bucketCeil) buckets[i] = (buckets[i] ?? 0) + 1;
    }
    this.latencyBuckets.set(key, buckets);
    this.latencySums.set(key, (this.latencySums.get(key) ?? 0) + latencyMs);
    this.latencyCounts.set(key, (this.latencyCounts.get(key) ?? 0) + 1);
  }

  setBudgetRatio(workspaceId: string, ratio: number): void {
    // Clamp to [0, 2] so runaway reconcile bugs don't push a gauge to Infinity;
    // dashboards can still see > 1 as "over budget" without breaking rendering.
    const clamped = Math.max(0, Math.min(ratio, 2));
    this.budgetRatio.set(workspaceId, clamped);
  }

  incrementFallback(from: LlmProviderName, to: LlmProviderName, reason: string): void {
    const key = `${from}|${to}|${reason}`;
    this.fallbacksTotal.set(key, (this.fallbacksTotal.get(key) ?? 0) + 1);
  }

  incrementFeedback(action: AiAction, rating: AiFeedbackRating): void {
    const key = `${action}|${rating}`;
    this.feedbackTotal.set(key, (this.feedbackTotal.get(key) ?? 0) + 1);
  }

  render(): string {
    const lines: string[] = [];

    lines.push(
      '# HELP tasker_ai_invocations_total AI invocations by action/provider/model/status.',
    );
    lines.push('# TYPE tasker_ai_invocations_total counter');
    for (const [key, value] of this.invocationsTotal) {
      const [action, provider, model, status] = key.split('|');
      lines.push(
        `tasker_ai_invocations_total{action="${action}",provider="${provider}",model="${model}",status="${status}"} ${value}`,
      );
    }

    lines.push('# HELP tasker_ai_tokens_total AI tokens accounted (input/output/cached_input).');
    lines.push('# TYPE tasker_ai_tokens_total counter');
    for (const [key, value] of this.tokensTotal) {
      const [action, provider, kind] = key.split('|');
      lines.push(
        `tasker_ai_tokens_total{action="${action}",provider="${provider}",kind="${kind}"} ${value}`,
      );
    }

    lines.push('# HELP tasker_ai_latency_ms AI invocation latency (ms).');
    lines.push('# TYPE tasker_ai_latency_ms histogram');
    for (const [key, buckets] of this.latencyBuckets) {
      const [action, provider] = key.split('|');
      for (let i = 0; i < LATENCY_BUCKETS_MS.length; i += 1) {
        lines.push(
          `tasker_ai_latency_ms_bucket{action="${action}",provider="${provider}",le="${LATENCY_BUCKETS_MS[i]}"} ${buckets[i]}`,
        );
      }
      const count = this.latencyCounts.get(key) ?? 0;
      lines.push(
        `tasker_ai_latency_ms_bucket{action="${action}",provider="${provider}",le="+Inf"} ${count}`,
      );
      lines.push(
        `tasker_ai_latency_ms_sum{action="${action}",provider="${provider}"} ${this.latencySums.get(key) ?? 0}`,
      );
      lines.push(`tasker_ai_latency_ms_count{action="${action}",provider="${provider}"} ${count}`);
    }

    lines.push('# HELP tasker_ai_budget_ratio Current-month consumed/budget ratio per workspace.');
    lines.push('# TYPE tasker_ai_budget_ratio gauge');
    for (const [workspaceId, ratio] of this.budgetRatio) {
      lines.push(`tasker_ai_budget_ratio{workspaceId="${workspaceId}"} ${ratio}`);
    }

    lines.push(
      '# HELP tasker_ai_provider_fallbacks_total Provider fallbacks triggered by the router.',
    );
    lines.push('# TYPE tasker_ai_provider_fallbacks_total counter');
    for (const [key, value] of this.fallbacksTotal) {
      const [from, to, reason] = key.split('|');
      lines.push(
        `tasker_ai_provider_fallbacks_total{from="${from}",to="${to}",reason="${reason}"} ${value}`,
      );
    }

    lines.push('# HELP tasker_ai_feedback_total 👍/👎 counts by action/rating.');
    lines.push('# TYPE tasker_ai_feedback_total counter');
    for (const [key, value] of this.feedbackTotal) {
      const [action, rating] = key.split('|');
      lines.push(`tasker_ai_feedback_total{action="${action}",rating="${rating}"} ${value}`);
    }

    return lines.join('\n') + '\n';
  }
}
