import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiBudgetService, BudgetReservation } from '../budget/ai-budget.service';
import { PromptBuilder } from '../prompt/prompt-builder';
import { LlmRouter } from '../providers/llm-router';
import { AiInvocationRecorder } from '../recorder/ai-invocation.recorder';
import { LlmProviderError, LlmProviderName } from '../providers/llm-provider.port';

const MAX_TOKENS = 900;
export const MIN_COMMENTS_FOR_SUMMARY = 10;

export interface SummarizeCommentsInput {
  workspaceId: string;
  actorUserId: string;
  taskId: string;
  signal?: AbortSignal;
}

/**
 * Summarizes a task's comment thread. Guarded by `MIN_COMMENTS_FOR_SUMMARY`
 * — the tech spec's minimum threshold; below it the action must not be
 * offered by the client, and the server refuses defensively (Problem
 * Details `ai-insufficient-context`, 422).
 */
@Injectable()
export class SummarizeCommentsService {
  constructor(
    private readonly router: LlmRouter,
    private readonly prompts: PromptBuilder,
    private readonly prisma: PrismaService,
    private readonly budget: AiBudgetService,
    private readonly recorder: AiInvocationRecorder,
  ) {}

  async *execute(input: SummarizeCommentsInput): AsyncIterable<{ delta: string; done: boolean }> {
    const start = Date.now();
    let reservation: BudgetReservation | undefined;
    let provider: LlmProviderName = 'anthropic';
    let model = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let status: 'OK' | 'ERROR' | 'ABORTED' = 'OK';
    let errorCode: string | undefined;

    const comments = await this.prisma.forSystem().comment.findMany({
      where: { workspaceId: input.workspaceId, taskId: input.taskId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { authorUserId: true, body: true, createdAt: true },
    });

    if (comments.length < MIN_COMMENTS_FOR_SUMMARY) {
      throw insufficientContext(
        `The thread has ${comments.length} comment(s); ${MIN_COMMENTS_FOR_SUMMARY} required to summarize.`,
      );
    }

    try {
      reservation = await this.budget.reserve(input.workspaceId, MAX_TOKENS);
      const thread = comments
        .map((c) => `[${c.createdAt.toISOString()}] ${c.authorUserId}: ${c.body}`)
        .join('\n');
      const built = this.prompts.build({
        workspaceId: input.workspaceId,
        workspacePreface: WORKSPACE_PREFACE,
        actionInstruction: ACTION_INSTRUCTION,
        untrustedUserContent: thread,
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
        errorCode = err.reason;
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
        action: 'SUMMARIZE_COMMENTS',
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
}

function insufficientContext(detail: string): HttpException {
  return new HttpException(
    {
      type: 'about:blank#ai-insufficient-context',
      title: 'Insufficient context to summarize',
      detail,
      status: 422,
    },
    422,
  );
}

const WORKSPACE_PREFACE =
  `You are Tasker's discussion-summary assistant. Comments are chronological, each ` +
  `prefixed with an ISO timestamp and the author's user id. Focus on decisions, open ` +
  `questions, and action items — not who said what.`;

const ACTION_INSTRUCTION =
  `Produce a concise Markdown summary with three sections: "Decisions", "Open ` +
  `questions", and "Action items". Under 200 words total. Preserve any explicit ` +
  `numbers/dates. If the thread does not contain a resolution, say so explicitly in ` +
  `"Open questions"; do not invent one.`;
