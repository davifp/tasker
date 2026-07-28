import { describe, expect, it, vi } from 'vitest';
import { PromptBuilder } from '../prompt/prompt-builder';
import { EstimateAndSuggestService } from './estimate-and-suggest.service';

function makeDeps({
  task,
  members = [
    { userId: 'u1', user: { displayName: 'Alice' } },
    { userId: 'u2', user: { displayName: 'Bob' } },
  ],
}: {
  task: {
    title: string;
    description: string | null;
    projectId: string;
    project: { name: string };
  } | null;
  members?: Array<{ userId: string; user: { displayName: string } }>;
}) {
  const taskFindFirst = vi.fn().mockResolvedValue(task);
  const membersFindMany = vi.fn().mockResolvedValue(members);
  const prisma = {
    forSystem: () => ({
      task: { findFirst: taskFindFirst },
      workspaceMember: { findMany: membersFindMany },
    }),
  } as unknown as ConstructorParameters<typeof EstimateAndSuggestService>[2];

  const router = { complete: vi.fn() } as unknown as ConstructorParameters<
    typeof EstimateAndSuggestService
  >[0];
  const budget = {
    reserve: vi.fn().mockResolvedValue({ workspaceId: 'ws', billingMonth: '2026-07', tokens: 600 }),
    reconcile: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof EstimateAndSuggestService>[3];
  const recorder = {
    record: vi.fn().mockResolvedValue({ invocationId: 'inv-1' }),
  } as unknown as ConstructorParameters<typeof EstimateAndSuggestService>[4];
  return { router, budget, recorder, prisma };
}

describe('EstimateAndSuggestService', () => {
  const validTask = {
    title: 'Ship dashboard',
    description: 'Add a dashboard with 3 charts',
    projectId: 'proj-1',
    project: { name: 'Analytics' },
  };

  it('returns the structured payload and filters assignees to workspace members', async () => {
    const d = makeDeps({ task: validTask });
    (d.router as unknown as { complete: ReturnType<typeof vi.fn> }).complete.mockResolvedValue({
      provider: 'anthropic',
      value: {
        value: {
          estimate: { low: 2, high: 6, confidence: 'medium' as const },
          priority: 'MEDIUM' as const,
          assignees: [
            { userId: 'u1', reason: 'Owns the auth' },
            // outside the roster — MUST be dropped.
            { userId: 'ghost-user', reason: 'invented' },
          ],
          insufficientContext: false,
        },
        model: 'claude-sonnet-4-6',
        usage: { inputTokens: 40, outputTokens: 30, cachedInputTokens: 5 },
      },
    });

    const svc = new EstimateAndSuggestService(
      d.router,
      new PromptBuilder(),
      d.prisma,
      d.budget,
      d.recorder,
    );
    const out = await svc.execute({ workspaceId: 'ws', actorUserId: 'user', taskId: 'task-1' });

    expect(out.result.assignees.map((a) => a.userId)).toEqual(['u1']);
    expect(out.result.priority).toBe('MEDIUM');
    expect(out.invocationId).toBe('inv-1');
    expect(
      (d.recorder as unknown as { record: ReturnType<typeof vi.fn> }).record,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ESTIMATE_AND_SUGGEST', status: 'OK' }),
    );
  });

  it('rejects with ai-insufficient-context when the model reports it', async () => {
    const d = makeDeps({ task: validTask });
    (d.router as unknown as { complete: ReturnType<typeof vi.fn> }).complete.mockResolvedValue({
      provider: 'anthropic',
      value: {
        value: {
          estimate: { low: 0, high: 0, confidence: 'low' as const },
          priority: 'LOW' as const,
          assignees: [],
          insufficientContext: true,
        },
        model: 'claude-sonnet-4-6',
        usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
      },
    });

    const svc = new EstimateAndSuggestService(
      d.router,
      new PromptBuilder(),
      d.prisma,
      d.budget,
      d.recorder,
    );
    const err = await svc
      .execute({ workspaceId: 'ws', actorUserId: 'user', taskId: 'task-1' })
      .catch((e) => e);
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse().type).toBe('about:blank#ai-insufficient-context');
  });

  it('rejects with ai-insufficient-context when task not found', async () => {
    const d = makeDeps({ task: null });
    const svc = new EstimateAndSuggestService(
      d.router,
      new PromptBuilder(),
      d.prisma,
      d.budget,
      d.recorder,
    );
    const err = await svc
      .execute({ workspaceId: 'ws', actorUserId: 'user', taskId: 'task-1' })
      .catch((e) => e);
    expect(err.getStatus()).toBe(422);
  });
});
