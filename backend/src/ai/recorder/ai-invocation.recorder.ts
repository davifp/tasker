import { Injectable, Logger } from '@nestjs/common';
import type { AiAction, AiInvocationStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuditAiMetadata } from '../../common/audit/audit-metadata.types';
import { AuditEvent } from '../../common/audit/audit.events';
import { TraceContext } from '../../common/trace/trace-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AiMetricsCollector } from '../metrics/ai.metrics';
import type { LlmProviderName } from '../providers/llm-provider.port';

export interface AiInvocationRecord {
  workspaceId: string;
  actorUserId: string;
  action: AiAction;
  targetType?: string;
  targetId?: string;
  provider: LlmProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  latencyMs: number;
  status: AiInvocationStatus;
  errorCode?: string;
  /**
   * Populated when the router fell back from `provider` to another one. Used
   * to bump `tasker_ai_provider_fallbacks_total{from,to,reason}`.
   */
  fallback?: { from: LlmProviderName; reason: string };
}

/**
 * Persists a single AI invocation to two places at once and updates every
 * Prometheus counter/histogram that keys off invocation data.
 *
 * Dual-write rationale:
 *
 *  - `AiInvocation` is the analytics/dashboard table — indexed by
 *    workspace/action/actor, retained forever, queried by the AI dashboard.
 *  - `AuditLog` is the compliance table — one row per side-effecting event,
 *    including AI cost fields nested under `metadata.ai` per the contract
 *    documented in `AuditMetadataShape`. Retained per the platform audit
 *    policy, shared with the audit export UI.
 *
 * Both rows share the same `traceId` (from `TraceContext`) so a support
 * request can jump from an audit line to the AI invocation and vice versa.
 * A failure to record must never fail the originating request (observability
 * ≠ correctness) — both the DB write and the metrics update are wrapped and
 * logged on failure.
 */
@Injectable()
export class AiInvocationRecorder {
  private readonly logger = new Logger(AiInvocationRecorder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: AiMetricsCollector,
  ) {}

  async record(input: AiInvocationRecord): Promise<{ invocationId: string }> {
    const traceId = TraceContext.get() ?? null;
    let invocationId = 'unrecorded';
    try {
      const created = await this.prisma.forSystem().aiInvocation.create({
        data: {
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          provider: input.provider,
          model: input.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          cachedInputTokens: input.cachedInputTokens,
          latencyMs: input.latencyMs,
          status: input.status,
          errorCode: input.errorCode ?? null,
          traceId,
        },
        select: { id: true },
      });
      invocationId = created.id;
    } catch (err) {
      this.logger.warn(
        { err, action: input.action, workspaceId: input.workspaceId },
        'Failed to persist AiInvocation row',
      );
    }

    const ai: AuditAiMetadata = {
      action: input.action,
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cachedInputTokens: input.cachedInputTokens,
      latencyMs: input.latencyMs,
      status: input.status,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    };
    try {
      await this.audit.record({
        event: AuditEvent.AI_INVOCATION,
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: { ai: ai as unknown as Prisma.InputJsonValue } as Prisma.InputJsonValue,
      });
    } catch (err) {
      this.logger.warn({ err }, 'Failed to record AI audit log entry');
    }

    try {
      this.metrics.incrementInvocation(input.action, input.provider, input.model, input.status);
      this.metrics.addTokens(input.action, input.provider, 'input', input.inputTokens);
      this.metrics.addTokens(input.action, input.provider, 'output', input.outputTokens);
      this.metrics.addTokens(input.action, input.provider, 'cached_input', input.cachedInputTokens);
      this.metrics.observeLatency(input.action, input.provider, input.latencyMs);
      if (input.fallback) {
        this.metrics.incrementFallback(input.fallback.from, input.provider, input.fallback.reason);
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to update AI metrics');
    }

    return { invocationId };
  }
}
