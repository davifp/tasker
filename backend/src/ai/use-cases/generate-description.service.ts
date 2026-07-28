import { HttpException, Injectable, Logger } from '@nestjs/common';
import { AiBudgetService, BudgetReservation } from '../budget/ai-budget.service';
import { PromptBuilder } from '../prompt/prompt-builder';
import { LlmRouter } from '../providers/llm-router';
import { AiInvocationRecorder } from '../recorder/ai-invocation.recorder';
import type { LlmProviderName } from '../providers/llm-provider.port';
import { LlmProviderError } from '../providers/llm-provider.port';

const MAX_TOKENS = 800;

export interface GenerateDescriptionInput {
  workspaceId: string;
  actorUserId: string;
  taskId: string;
  title: string;
  projectName?: string;
  labels?: string[];
  relatedTaskTitles?: string[];
  signal?: AbortSignal;
}

/**
 * Streams a draft task description as SSE text deltas. The caller (controller)
 * pipes the async iterable of `{ delta, done }` into the response and, in a
 * `finally`, calls `AiInvocationRecorder.record()` with the metadata collected
 * here — including the final usage counters the terminal chunk carries.
 */
@Injectable()
export class GenerateDescriptionService {
  private readonly logger = new Logger(GenerateDescriptionService.name);

  constructor(
    private readonly router: LlmRouter,
    private readonly prompts: PromptBuilder,
    private readonly budget: AiBudgetService,
    private readonly recorder: AiInvocationRecorder,
  ) {}

  async *execute(input: GenerateDescriptionInput): AsyncIterable<{ delta: string; done: boolean }> {
    const start = Date.now();
    let reservation: BudgetReservation | undefined;
    let provider: LlmProviderName = 'anthropic';
    let model = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let status: 'OK' | 'ERROR' | 'ABORTED' = 'OK';
    let errorCode: string | undefined;

    try {
      reservation = await this.budget.reserve(input.workspaceId, MAX_TOKENS);
      const built = this.prompts.build({
        workspaceId: input.workspaceId,
        workspacePreface: WORKSPACE_PREFACE,
        actionInstruction: ACTION_INSTRUCTION,
        volatileSystem: this.volatileContext(input),
        untrustedUserContent: input.title,
      });

      const stream = this.router.stream({
        workspaceId: input.workspaceId,
        cacheKey: built.cacheKey,
        systemBlocks: built.systemBlocks,
        userMessage: built.userMessage,
        maxTokens: MAX_TOKENS,
        signal: input.signal,
      });

      for await (const chunk of stream) {
        if (chunk.delta) yield { delta: chunk.delta, done: false };
        if (chunk.done) {
          if (chunk.usage) {
            inputTokens = chunk.usage.inputTokens;
            outputTokens = chunk.usage.outputTokens;
            cachedInputTokens = chunk.usage.cachedInputTokens;
          }
          if (chunk.model) model = chunk.model;
        }
      }
      yield { delta: '', done: true };
    } catch (err) {
      status = 'ERROR';
      if (err instanceof LlmProviderError) {
        errorCode = err.reason === 'aborted' ? 'ai-aborted' : err.reason;
        provider = err.provider;
        if (err.reason === 'aborted') status = 'ABORTED';
      } else if (err instanceof HttpException) {
        errorCode = String(err.getStatus());
      } else {
        errorCode = 'unknown';
      }
      throw err;
    } finally {
      const latencyMs = Date.now() - start;
      if (reservation) {
        await this.budget.reconcile(reservation, inputTokens + outputTokens);
      }
      void this.recorder.record({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        action: 'GENERATE_DESCRIPTION',
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
      });
    }
  }

  private volatileContext(input: GenerateDescriptionInput): string {
    const parts: string[] = [];
    if (input.projectName) parts.push(`Project: ${input.projectName}`);
    if (input.labels && input.labels.length > 0) parts.push(`Labels: ${input.labels.join(', ')}`);
    if (input.relatedTaskTitles && input.relatedTaskTitles.length > 0) {
      parts.push(`Related tasks: ${input.relatedTaskTitles.slice(0, 5).join(' | ')}`);
    }
    return parts.join('\n');
  }
}

const WORKSPACE_PREFACE =
  `You are Tasker's task-writing assistant. Tasker is a multi-tenant work-management ` +
  `product; every task belongs to a workspace and a project. Descriptions should be ` +
  `structured, actionable, and specific to the task at hand.`;

const ACTION_INSTRUCTION =
  `Given a short task title (and optional project/label/related-task context), draft a ` +
  `complete description in Markdown with these sections when relevant: Context, Goal, ` +
  `Scope, Non-goals, Acceptance criteria. Keep it under 250 words. Do not invent ` +
  `stakeholders, deadlines, or numeric metrics that are not in the title. If the title ` +
  `is too vague to describe, reply with: "Please add a title with more detail."`;
