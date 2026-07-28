import { describe, expect, it, vi } from 'vitest';
import { PromptBuilder } from '../prompt/prompt-builder';
import { SummarizeCommentsService, MIN_COMMENTS_FOR_SUMMARY } from './summarize-comments.service';

function makeDeps(commentCount: number) {
  const findMany = vi.fn().mockResolvedValue(
    Array.from({ length: commentCount }, (_, i) => ({
      authorUserId: `user-${i}`,
      body: `Comment #${i}`,
      createdAt: new Date(2026, 6, i + 1),
    })),
  );
  const prisma = {
    forSystem: () => ({ comment: { findMany } }),
  } as unknown as ConstructorParameters<typeof SummarizeCommentsService>[2];

  const router = { stream: vi.fn() } as unknown as ConstructorParameters<
    typeof SummarizeCommentsService
  >[0];
  const budget = {
    reserve: vi.fn().mockResolvedValue({ workspaceId: 'ws', billingMonth: '2026-07', tokens: 900 }),
    reconcile: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof SummarizeCommentsService>[3];
  const recorder = {
    record: vi.fn().mockResolvedValue({ invocationId: 'inv-1' }),
  } as unknown as ConstructorParameters<typeof SummarizeCommentsService>[4];
  return { router, budget, recorder, prisma };
}

describe('SummarizeCommentsService', () => {
  it('rejects with ai-insufficient-context when the thread is below the threshold', async () => {
    const d = makeDeps(MIN_COMMENTS_FOR_SUMMARY - 1);
    const svc = new SummarizeCommentsService(
      d.router,
      new PromptBuilder(),
      d.prisma,
      d.budget,
      d.recorder,
    );
    const err = await (async () => {
      try {
        for await (const _ of svc.execute({
          workspaceId: 'ws',
          actorUserId: 'user',
          taskId: 'task-1',
        })) {
          // consume
        }
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeDefined();
    const httpErr = err as { getStatus(): number; getResponse(): { type: string } };
    expect(httpErr.getStatus()).toBe(422);
    expect(httpErr.getResponse().type).toBe('about:blank#ai-insufficient-context');
    expect(
      (d.budget as unknown as { reserve: ReturnType<typeof vi.fn> }).reserve,
    ).not.toHaveBeenCalled();
  });

  it('proceeds when the thread meets the threshold', async () => {
    const d = makeDeps(MIN_COMMENTS_FOR_SUMMARY);
    (d.router as unknown as { stream: ReturnType<typeof vi.fn> }).stream.mockImplementation(
      async function* () {
        yield { delta: 'summary', done: false };
        yield {
          delta: '',
          done: true,
          model: 'claude-sonnet-4-6',
          usage: { inputTokens: 300, outputTokens: 80, cachedInputTokens: 40 },
        };
      },
    );
    const svc = new SummarizeCommentsService(
      d.router,
      new PromptBuilder(),
      d.prisma,
      d.budget,
      d.recorder,
    );
    const chunks: Array<{ delta: string; done: boolean }> = [];
    for await (const c of svc.execute({
      workspaceId: 'ws',
      actorUserId: 'user',
      taskId: 'task-1',
    })) {
      chunks.push(c);
    }
    expect(chunks.some((c) => c.delta === 'summary')).toBe(true);
    expect(
      (d.recorder as unknown as { record: ReturnType<typeof vi.fn> }).record,
    ).toHaveBeenCalledWith(expect.objectContaining({ action: 'SUMMARIZE_COMMENTS', status: 'OK' }));
  });
});
