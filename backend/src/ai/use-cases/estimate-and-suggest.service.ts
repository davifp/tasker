import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiBudgetService, BudgetReservation } from '../budget/ai-budget.service';
import { PromptBuilder } from '../prompt/prompt-builder';
import { LlmRouter } from '../providers/llm-router';
import { AiInvocationRecorder } from '../recorder/ai-invocation.recorder';
import { LlmProviderError, LlmProviderName } from '../providers/llm-provider.port';
import { EstimateAndSuggestResultSchema, type EstimateAndSuggestResult } from '../dto';

const MAX_TOKENS = 600;

export interface EstimateAndSuggestInput {
  workspaceId: string;
  actorUserId: string;
  taskId: string;
  signal?: AbortSignal;
}

export interface EstimateAndSuggestOutput {
  invocationId: string;
  result: EstimateAndSuggestResult;
}

/**
 * Returns a per-field triage suggestion: estimate range with a confidence
 * hint, priority, and up to three likely assignees drawn from the project's
 * member set. Non-streaming JSON — the client renders three chips in one
 * paint, so streaming would add latency without UX value.
 *
 * Assignee suggestions are hard-filtered to actual project members after
 * the model returns; the LLM may only suggest user ids visible in the
 * prompt (which we scope to workspace members with access to the task's
 * project). Any suggestion outside that set is dropped in `filterAssignees`.
 */
@Injectable()
export class EstimateAndSuggestService {
  constructor(
    private readonly router: LlmRouter,
    private readonly prompts: PromptBuilder,
    private readonly prisma: PrismaService,
    private readonly budget: AiBudgetService,
    private readonly recorder: AiInvocationRecorder,
  ) {}

  async execute(input: EstimateAndSuggestInput): Promise<EstimateAndSuggestOutput> {
    const start = Date.now();
    let reservation: BudgetReservation | undefined;
    let provider: LlmProviderName = 'anthropic';
    let model = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let status: 'OK' | 'ERROR' | 'ABORTED' = 'OK';
    let errorCode: string | undefined;
    let fallback: { from: LlmProviderName; reason: string } | undefined;

    const task = await this.prisma.forSystem().task.findFirst({
      where: { id: input.taskId, workspaceId: input.workspaceId, deletedAt: null },
      select: {
        title: true,
        description: true,
        projectId: true,
        project: { select: { name: true } },
      },
    });
    if (!task) {
      throw insufficientContext('Task not found in this workspace.');
    }

    // Project-scoped member set (v1: workspace-scoped membership; every
    // workspace member has access to every project, so this is currently
    // equivalent to the workspace member list).
    const members = await this.prisma.forSystem().workspaceMember.findMany({
      where: { workspaceId: input.workspaceId },
      select: {
        userId: true,
        user: { select: { displayName: true } },
      },
    });

    try {
      reservation = await this.budget.reserve(input.workspaceId, MAX_TOKENS);
      const memberRoster = members.map((m) => `${m.userId} (${m.user.displayName})`).join('\n');

      const built = this.prompts.build({
        workspaceId: input.workspaceId,
        workspacePreface: WORKSPACE_PREFACE,
        actionInstruction: ACTION_INSTRUCTION,
        volatileSystem: `Project: ${task.project?.name ?? 'Unknown'}\nCandidate assignees:\n${memberRoster}`,
        untrustedUserContent: `Title: ${task.title}\n\nDescription:\n${task.description ?? '(empty)'}`,
      });

      const outcome = await this.router.complete({
        workspaceId: input.workspaceId,
        cacheKey: built.cacheKey,
        systemBlocks: built.systemBlocks,
        userMessage: built.userMessage,
        maxTokens: MAX_TOKENS,
        schema: EstimateAndSuggestResultSchema,
        schemaName: 'estimate_and_suggest',
        schemaDescription: 'Effort estimate, priority, and up to 3 assignee suggestions',
        signal: input.signal,
      });

      provider = outcome.provider;
      if (outcome.fallbackReason) fallback = { from: 'anthropic', reason: outcome.fallbackReason };
      model = outcome.value.model;
      inputTokens = outcome.value.usage.inputTokens;
      outputTokens = outcome.value.usage.outputTokens;
      cachedInputTokens = outcome.value.usage.cachedInputTokens;

      const result = this.filterAssignees(outcome.value.value, members);

      if (result.insufficientContext) {
        throw insufficientContext('The model returned insufficientContext = true for this task.');
      }

      const { invocationId } = await this.recorder.record({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: 'ESTIMATE_AND_SUGGEST',
        targetType: 'task',
        targetId: input.taskId,
        provider,
        model,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        latencyMs: Date.now() - start,
        status: 'OK',
        fallback,
      });
      if (reservation) await this.budget.reconcile(reservation, inputTokens + outputTokens);
      return { invocationId, result };
    } catch (err) {
      status = 'ERROR';
      if (err instanceof LlmProviderError) {
        errorCode = err.reason;
        provider = err.provider;
        if (err.reason === 'aborted') status = 'ABORTED';
      } else if (err instanceof HttpException) {
        errorCode = String(err.getStatus());
      } else {
        errorCode = 'unknown';
      }
      const latencyMs = Date.now() - start;
      if (reservation) await this.budget.reconcile(reservation, inputTokens + outputTokens);
      await this.recorder.record({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: 'ESTIMATE_AND_SUGGEST',
        targetType: 'task',
        targetId: input.taskId,
        provider,
        model: model || 'unknown',
        inputTokens,
        outputTokens,
        cachedInputTokens,
        latencyMs,
        status,
        errorCode,
        fallback,
      });
      throw err;
    }
  }

  private filterAssignees(
    result: EstimateAndSuggestResult,
    members: Array<{ userId: string }>,
  ): EstimateAndSuggestResult {
    const allowed = new Set(members.map((m) => m.userId));
    return {
      ...result,
      assignees: result.assignees.filter((a) => allowed.has(a.userId)),
    };
  }
}

function insufficientContext(detail: string): HttpException {
  return new HttpException(
    {
      type: 'about:blank#ai-insufficient-context',
      title: 'Insufficient context for suggestions',
      detail,
      status: 422,
    },
    422,
  );
}

const WORKSPACE_PREFACE =
  `You are Tasker's triage assistant. You suggest an effort estimate (in hours), a ` +
  `priority (LOW/MEDIUM/HIGH), and up to three assignees from the candidate roster.`;

const ACTION_INSTRUCTION =
  `Return ONE JSON object matching the tool schema. estimate.low and estimate.high are ` +
  `positive integers of hours (low <= high); confidence in {low, medium, high} reflects ` +
  `your certainty. priority in {LOW, MEDIUM, HIGH}. assignees: up to 3 candidates from ` +
  `the roster — never a userId not listed. If context is too sparse (empty description + ` +
  `no meaningful title), set insufficientContext = true and leave the other fields at ` +
  `their neutral defaults.`;
