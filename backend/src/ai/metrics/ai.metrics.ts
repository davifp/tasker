import { Injectable } from '@nestjs/common';
import type { Counter, Gauge, Histogram } from 'prom-client';
import type { AiAction, AiFeedbackRating, AiInvocationStatus } from '@prisma/client';
import { MetricsRegistryService } from '../../metrics/metrics-registry.service';
import type { LlmProviderName } from '../providers/llm-provider.port';

const LATENCY_BUCKETS_MS = [100, 250, 500, 1000, 2000, 3000, 5000, 10_000] as const;

// AI action metrics. Label cardinality budget documented in the techspec —
// `workspaceId` is only attached to the budget gauge and grows with tenants.
@Injectable()
export class AiMetricsCollector {
  private readonly invocationsTotal: Counter<'action' | 'provider' | 'model' | 'status'>;
  private readonly tokensTotal: Counter<'action' | 'provider' | 'kind'>;
  private readonly latencyMs: Histogram<'action' | 'provider'>;
  private readonly budgetRatio: Gauge<'workspaceId'>;
  private readonly fallbacksTotal: Counter<'from' | 'to' | 'reason'>;
  private readonly feedbackTotal: Counter<'action' | 'rating'>;

  constructor(registry: MetricsRegistryService) {
    this.invocationsTotal = registry.counter({
      name: 'tasker_ai_invocations_total',
      help: 'AI invocations by action/provider/model/status.',
      labelNames: ['action', 'provider', 'model', 'status'] as const,
    });
    this.tokensTotal = registry.counter({
      name: 'tasker_ai_tokens_total',
      help: 'AI tokens accounted (input/output/cached_input).',
      labelNames: ['action', 'provider', 'kind'] as const,
    });
    this.latencyMs = registry.histogram({
      name: 'tasker_ai_latency_ms',
      help: 'AI invocation latency (ms).',
      labelNames: ['action', 'provider'] as const,
      buckets: [...LATENCY_BUCKETS_MS],
    });
    this.budgetRatio = registry.gauge({
      name: 'tasker_ai_budget_ratio',
      help: 'Current-month consumed/budget ratio per workspace.',
      labelNames: ['workspaceId'] as const,
    });
    this.fallbacksTotal = registry.counter({
      name: 'tasker_ai_provider_fallbacks_total',
      help: 'Provider fallbacks triggered by the router.',
      labelNames: ['from', 'to', 'reason'] as const,
    });
    this.feedbackTotal = registry.counter({
      name: 'tasker_ai_feedback_total',
      help: 'Thumbs-up/-down counts by action/rating.',
      labelNames: ['action', 'rating'] as const,
    });
  }

  incrementInvocation(
    action: AiAction,
    provider: LlmProviderName,
    model: string,
    status: AiInvocationStatus,
  ): void {
    this.invocationsTotal.inc({ action, provider, model, status });
  }

  addTokens(
    action: AiAction,
    provider: LlmProviderName,
    kind: 'input' | 'output' | 'cached_input',
    count: number,
  ): void {
    if (count <= 0) return;
    this.tokensTotal.inc({ action, provider, kind }, count);
  }

  observeLatency(action: AiAction, provider: LlmProviderName, latencyMs: number): void {
    this.latencyMs.observe({ action, provider }, latencyMs);
  }

  setBudgetRatio(workspaceId: string, ratio: number): void {
    // Clamp to [0, 2] so runaway reconcile bugs don't push a gauge to Infinity;
    // dashboards can still see > 1 as "over budget" without breaking rendering.
    this.budgetRatio.set({ workspaceId }, Math.max(0, Math.min(ratio, 2)));
  }

  incrementFallback(from: LlmProviderName, to: LlmProviderName, reason: string): void {
    this.fallbacksTotal.inc({ from, to, reason });
  }

  incrementFeedback(action: AiAction, rating: AiFeedbackRating): void {
    this.feedbackTotal.inc({ action, rating });
  }
}
