import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiBudgetService, BudgetReservation } from '../budget/ai-budget.service';
import { PromptBuilder } from '../prompt/prompt-builder';
import { LlmRouter } from '../providers/llm-router';
import { AiInvocationRecorder } from '../recorder/ai-invocation.recorder';
import { LlmProviderError, LlmProviderName } from '../providers/llm-provider.port';
import { GenerateChecklistResultSchema, type GenerateChecklistResult } from '../dto';

const MAX_TOKENS = 700;
const MIN_DESCRIPTION_LENGTH = 40;

export interface GenerateChecklistInput {
  workspaceId: string;
  actorUserId: string;
  taskId: string;
  signal?: AbortSignal;
}

export interface GenerateChecklistOutput {
  invocationId: string;
  result: GenerateChecklistResult;
}

/**
 * Structured non-streaming path: `LlmRouter.complete()` returns a validated
 * `{ items: string[] }` payload that the caller (`AiController`) forwards
 * over SSE as a single `event: result` frame followed by `event: done`.
 * Non-streaming here is a deliberate simplification — the model needs the
 * whole description in one pass to enumerate items, and the client renders
 * the checklist all-at-once anyway (a partial checklist is not useful).
 */
@Injectable()
export class GenerateChecklistService {
  constructor(
    private readonly router: LlmRouter,
    private readonly prompts: PromptBuilder,
    private readonly prisma: PrismaService,
    private readonly budget: AiBudgetService,
    private readonly recorder: AiInvocationRecorder,
  ) {}

  async execute(input: GenerateChecklistInput): Promise<GenerateChecklistOutput> {
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
      select: { title: true, description: true },
    });
    if (!task) {
      throw insufficientContext('Task not found in this workspace.');
    }
    if (!task.description || task.description.length < MIN_DESCRIPTION_LENGTH) {
      throw insufficientContext(
        `Task description is too short (${task.description.length} chars, minimum ${MIN_DESCRIPTION_LENGTH}).`,
      );
    }

    try {
      reservation = await this.budget.reserve(input.workspaceId, MAX_TOKENS);
      const built = this.prompts.build({
        workspaceId: input.workspaceId,
        workspacePreface: WORKSPACE_PREFACE,
        actionInstruction: ACTION_INSTRUCTION,
        untrustedUserContent: `Title: ${task.title}\n\nDescription:\n${task.description}`,
      });

      const outcome = await this.router.complete({
        workspaceId: input.workspaceId,
        cacheKey: built.cacheKey,
        systemBlocks: built.systemBlocks,
        userMessage: built.userMessage,
        maxTokens: MAX_TOKENS,
        schema: GenerateChecklistResultSchema,
        schemaName: 'generate_checklist',
        schemaDescription: 'Actionable checklist derived from a task description',
        signal: input.signal,
      });

      provider = outcome.provider;
      if (outcome.fallbackReason) fallback = { from: 'anthropic', reason: outcome.fallbackReason };
      model = outcome.value.model;
      inputTokens = outcome.value.usage.inputTokens;
      outputTokens = outcome.value.usage.outputTokens;
      cachedInputTokens = outcome.value.usage.cachedInputTokens;

      const { invocationId } = await this.record({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
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
      return { invocationId, result: outcome.value.value };
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
      if (reservation) {
        await this.budget.reconcile(reservation, inputTokens + outputTokens);
      }
      await this.record({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
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

  private record(payload: Omit<Parameters<AiInvocationRecorder['record']>[0], 'action'>) {
    return this.recorder.record({ ...payload, action: 'GENERATE_CHECKLIST' });
  }
}

function insufficientContext(detail: string): HttpException {
  return new HttpException(
    {
      type: 'about:blank#ai-insufficient-context',
      title: 'Insufficient context to generate checklist',
      detail,
      status: 422,
    },
    422,
  );
}

const WORKSPACE_PREFACE =
  `You are Tasker's checklist-generation assistant. A checklist is a flat list of ` +
  `short, imperative steps (5–15 items) that a task owner can tick off in order.`;

const ACTION_INSTRUCTION =
  `From the task title and description, produce a checklist. Each item MUST start with ` +
  `an imperative verb, MUST fit on one line (~120 chars), and MUST be independently ` +
  `actionable. Prefer 5–10 items; hard-cap at 30.`;
