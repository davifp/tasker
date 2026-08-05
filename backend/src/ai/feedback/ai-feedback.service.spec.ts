import { describe, expect, it, vi } from 'vitest';
import { AiMetricsCollector } from '../metrics/ai.metrics';
import { createTestMetricsRegistry } from '../../metrics/metrics-registry.test-helpers';
import { AiFeedbackService } from './ai-feedback.service';

function makeService(opts: {
  invocation?: { id: string; action: 'GENERATE_DESCRIPTION' } | null;
  createFails?: 'duplicate' | 'other';
}) {
  const findFirst = vi.fn().mockResolvedValue(opts.invocation ?? null);
  const create = opts.createFails
    ? vi
        .fn()
        .mockRejectedValue(opts.createFails === 'duplicate' ? { code: 'P2002' } : new Error('boom'))
    : vi.fn().mockResolvedValue({ id: 'fb-1' });
  const prisma = {
    forSystem: () => ({
      aiInvocation: { findFirst },
      aiFeedback: { create },
    }),
  } as unknown as ConstructorParameters<typeof AiFeedbackService>[0];
  const registry = createTestMetricsRegistry();
  const metrics = new AiMetricsCollector(registry);
  const svc = new AiFeedbackService(prisma, metrics);
  return { svc, create, findFirst, metrics, registry };
}

describe('AiFeedbackService', () => {
  it('persists feedback and bumps the metric', async () => {
    const { svc, registry } = makeService({
      invocation: { id: 'inv-1', action: 'GENERATE_DESCRIPTION' },
    });
    const out = await svc.submit('ws-1', 'user-1', {
      invocationId: 'inv-1',
      rating: 'POSITIVE',
    });
    expect(out.id).toBe('fb-1');
    const scrape = await registry.render();
    expect(scrape).toContain(
      'tasker_ai_feedback_total{action="GENERATE_DESCRIPTION",rating="POSITIVE"} 1',
    );
  });

  it('rejects with 404 when the invocation does not exist in this workspace', async () => {
    const { svc } = makeService({ invocation: null });
    const err = await svc
      .submit('ws-1', 'user-1', { invocationId: 'inv-x', rating: 'POSITIVE' })
      .catch((e) => e);
    expect(err.getStatus()).toBe(404);
    expect(err.getResponse().type).toBe('about:blank#ai-invocation-not-found');
  });

  it('rejects with 409 on duplicate rating from the same user', async () => {
    const { svc } = makeService({
      invocation: { id: 'inv-1', action: 'GENERATE_DESCRIPTION' },
      createFails: 'duplicate',
    });
    const err = await svc
      .submit('ws-1', 'user-1', { invocationId: 'inv-1', rating: 'POSITIVE' })
      .catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse().type).toBe('about:blank#ai-feedback-duplicate');
  });

  it('rethrows non-unique DB errors', async () => {
    const { svc } = makeService({
      invocation: { id: 'inv-1', action: 'GENERATE_DESCRIPTION' },
      createFails: 'other',
    });
    await expect(
      svc.submit('ws-1', 'user-1', { invocationId: 'inv-1', rating: 'POSITIVE' }),
    ).rejects.toThrow(/boom/);
  });
});
