import { describe, expect, it, vi } from 'vitest';
import { PromptBuilder } from '../prompt/prompt-builder';
import { GenerateChecklistService } from './generate-checklist.service';

function makeDeps(task: { title: string; description: string } | null) {
  const findFirst = vi.fn().mockResolvedValue(task);
  const prisma = {
    forSystem: () => ({ task: { findFirst } }),
  } as unknown as ConstructorParameters<typeof GenerateChecklistService>[2];

  const router = {
    complete: vi.fn(),
  } as unknown as ConstructorParameters<typeof GenerateChecklistService>[0];
  const budget = {
    reserve: vi.fn().mockResolvedValue({ workspaceId: 'ws', billingMonth: '2026-07', tokens: 700 }),
    reconcile: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof GenerateChecklistService>[3];
  const recorder = {
    record: vi.fn().mockResolvedValue({ invocationId: 'inv-1' }),
  } as unknown as ConstructorParameters<typeof GenerateChecklistService>[4];

  return { router, budget, recorder, prisma, findFirst };
}

describe('GenerateChecklistService', () => {
  it('rejects with ai-insufficient-context when the task is missing', async () => {
    const d = makeDeps(null);
    const svc = new GenerateChecklistService(
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

  it('rejects when the task description is too short', async () => {
    const d = makeDeps({ title: 'Do work', description: 'tiny' });
    const svc = new GenerateChecklistService(
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

  it('returns structured items on success + records the invocation', async () => {
    const d = makeDeps({
      title: 'Migrate auth to sessions',
      description:
        'A long enough description that easily exceeds the 40-character minimum threshold.',
    });
    (d.router as unknown as { complete: ReturnType<typeof vi.fn> }).complete.mockResolvedValue({
      provider: 'anthropic',
      value: {
        value: { items: ['Draft schema', 'Migrate routes', 'Add regression tests'] },
        model: 'claude-sonnet-4-6',
        usage: { inputTokens: 200, outputTokens: 60, cachedInputTokens: 80 },
      },
    });
    const svc = new GenerateChecklistService(
      d.router,
      new PromptBuilder(),
      d.prisma,
      d.budget,
      d.recorder,
    );
    const out = await svc.execute({
      workspaceId: 'ws',
      actorUserId: 'user',
      taskId: 'task-1',
    });
    expect(out.result.items).toEqual(['Draft schema', 'Migrate routes', 'Add regression tests']);
    expect(out.invocationId).toBe('inv-1');
    expect(
      (d.recorder as unknown as { record: ReturnType<typeof vi.fn> }).record,
    ).toHaveBeenCalledWith(expect.objectContaining({ action: 'GENERATE_CHECKLIST', status: 'OK' }));
  });
});
