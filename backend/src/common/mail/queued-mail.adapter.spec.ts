import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { QueuedMailAdapter } from './queued-mail.adapter';
import { MAIL_QUEUE } from '../../queues/constants';

const mockQueue = {
  add: vi.fn(),
};

async function buildAdapter(): Promise<QueuedMailAdapter> {
  const module = await Test.createTestingModule({
    providers: [QueuedMailAdapter, { provide: getQueueToken(MAIL_QUEUE), useValue: mockQueue }],
  }).compile();
  return module.get(QueuedMailAdapter);
}

describe('QueuedMailAdapter', () => {
  let adapter: QueuedMailAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    adapter = await buildAdapter();
  });

  it('enqueues a job with correct options and returns the job ID', async () => {
    mockQueue.add.mockResolvedValueOnce({ id: 'job-1' });

    const result = await adapter.send({
      template: 'email-verify',
      to: 'user@example.com',
      variables: { verifyUrl: 'https://tasker.dev/verify?token=abc' },
    });

    expect(result).toEqual({ jobId: 'job-1' });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ template: 'email-verify', to: 'user@example.com' }),
      expect.objectContaining({ attempts: 5, backoff: { type: 'exponential', delay: 1000 } }),
    );
  });

  it('passes idempotencyKey as jobId when provided', async () => {
    mockQueue.add.mockResolvedValueOnce({ id: 'idem-key' });

    await adapter.send({
      template: 'password-reset',
      to: 'user@example.com',
      variables: { resetUrl: 'https://tasker.dev/reset?token=xyz' },
      idempotencyKey: 'idem-key',
    });

    expect(mockQueue.add).toHaveBeenCalledWith(
      'send',
      expect.anything(),
      expect.objectContaining({ jobId: 'idem-key' }),
    );
  });

  it('omits jobId when no idempotencyKey is provided', async () => {
    mockQueue.add.mockResolvedValueOnce({ id: 'auto-id' });

    await adapter.send({
      template: 'invitation',
      to: 'user@example.com',
      variables: {
        workspaceName: 'Acme',
        inviterName: 'Alice',
        role: 'MEMBER',
        acceptUrl: 'https://tasker.dev/invite/x',
      },
    });

    const callOptions = mockQueue.add.mock.calls[0][2] as Record<string, unknown>;
    expect(callOptions).not.toHaveProperty('jobId');
  });
});
