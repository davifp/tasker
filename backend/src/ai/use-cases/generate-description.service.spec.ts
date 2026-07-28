import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerateDescriptionService } from './generate-description.service';
import { PromptBuilder } from '../prompt/prompt-builder';

function makeDeps() {
  const router = {
    stream: vi.fn(),
  } as unknown as ConstructorParameters<typeof GenerateDescriptionService>[0];
  const budget = {
    reserve: vi.fn().mockResolvedValue({ workspaceId: 'ws', billingMonth: '2026-07', tokens: 800 }),
    reconcile: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof GenerateDescriptionService>[2];
  const recorder = {
    record: vi.fn().mockResolvedValue({ invocationId: 'inv-1' }),
  } as unknown as ConstructorParameters<typeof GenerateDescriptionService>[3];
  const prompts = new PromptBuilder();
  return { router, budget, recorder, prompts };
}

async function collect(stream: AsyncIterable<{ delta: string; done: boolean }>) {
  const out: Array<{ delta: string; done: boolean }> = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe('GenerateDescriptionService', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it('streams provider deltas and records the invocation on success', async () => {
    (deps.router as unknown as { stream: ReturnType<typeof vi.fn> }).stream.mockImplementation(
      async function* () {
        yield { delta: 'Hel', done: false };
        yield { delta: 'lo', done: false };
        yield {
          delta: '',
          done: true,
          model: 'claude-sonnet-4-6',
          usage: { inputTokens: 50, outputTokens: 20, cachedInputTokens: 10 },
        };
      },
    );

    const svc = new GenerateDescriptionService(
      deps.router,
      deps.prompts,
      deps.budget,
      deps.recorder,
    );
    const chunks = await collect(
      svc.execute({
        workspaceId: 'ws',
        actorUserId: 'user',
        taskId: 'task-1',
        title: 'Refactor auth module',
      }),
    );

    expect(chunks.map((c) => c.delta).join('')).toBe('Hello');
    expect(chunks.at(-1)?.done).toBe(true);
    expect(
      (deps.recorder as unknown as { record: ReturnType<typeof vi.fn> }).record,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GENERATE_DESCRIPTION',
        model: 'claude-sonnet-4-6',
        inputTokens: 50,
        outputTokens: 20,
        cachedInputTokens: 10,
        status: 'OK',
      }),
    );
    expect(
      (deps.budget as unknown as { reconcile: ReturnType<typeof vi.fn> }).reconcile,
    ).toHaveBeenCalledWith({ workspaceId: 'ws', billingMonth: '2026-07', tokens: 800 }, 70);
  });

  it('records ERROR + reconciles reservation on provider failure', async () => {
    (deps.router as unknown as { stream: ReturnType<typeof vi.fn> }).stream.mockImplementation(
      async function* () {
        throw new Error('provider blew up');
      },
    );

    const svc = new GenerateDescriptionService(
      deps.router,
      deps.prompts,
      deps.budget,
      deps.recorder,
    );

    await expect(
      collect(
        svc.execute({
          workspaceId: 'ws',
          actorUserId: 'user',
          taskId: 'task-1',
          title: 'Anything',
        }),
      ),
    ).rejects.toThrow(/provider blew up/);

    expect(
      (deps.recorder as unknown as { record: ReturnType<typeof vi.fn> }).record,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ERROR', action: 'GENERATE_DESCRIPTION' }),
    );
    expect(
      (deps.budget as unknown as { reconcile: ReturnType<typeof vi.fn> }).reconcile,
    ).toHaveBeenCalled();
  });
});
