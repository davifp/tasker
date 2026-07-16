import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { MailProcessor } from './mail.processor';
import type { MailSendInput } from '../common/mail/mail.provider';

// Hoist mock so vi.mock can reference it
const sendMail = vi.fn();

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
  createTransport: () => ({ sendMail }),
}));

// Also mock Handlebars to avoid filesystem dependency in unit tests
vi.mock('handlebars', () => ({
  default: { compile: () => () => '<html>mock</html>' },
  compile: () => () => '<html>mock</html>',
}));

// And the readFileSync that loads templates
vi.mock('node:fs', () => ({ readFileSync: () => '{{var}}' }));

function makeJob(data: MailSendInput, attemptsMade = 0): Job<MailSendInput> {
  return { id: 'j1', data, attemptsMade } as unknown as Job<MailSendInput>;
}

async function buildProcessor(): Promise<MailProcessor> {
  const module = await Test.createTestingModule({
    providers: [
      MailProcessor,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, def: unknown) => def,
        },
      },
    ],
  }).compile();
  return module.get(MailProcessor);
}

describe('MailProcessor', () => {
  let processor: MailProcessor;

  beforeEach(async () => {
    vi.clearAllMocks();
    processor = await buildProcessor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls sendMail with to, subject, html, and text', async () => {
    sendMail.mockResolvedValueOnce({ messageId: 'ok' });
    const job = makeJob({
      template: 'email-verify',
      to: 'a@b.com',
      variables: { verifyUrl: 'https://x' },
    });

    await processor.process(job);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', subject: 'Verify your email address' }),
    );
  });

  it('re-throws transient SMTP errors so BullMQ retries', async () => {
    const transientErr = Object.assign(new Error('Connection reset'), { responseCode: 421 });
    sendMail.mockRejectedValueOnce(transientErr);

    await expect(
      processor.process(makeJob({ template: 'email-verify', to: 'a@b.com', variables: {} })),
    ).rejects.toThrow('Connection reset');
  });

  it('wraps permanent 5xx SMTP errors in UnrecoverableError to skip retries', async () => {
    const permanentErr = Object.assign(new Error('Mailbox not found'), { responseCode: 550 });
    sendMail.mockRejectedValueOnce(permanentErr);

    await expect(
      processor.process(makeJob({ template: 'email-verify', to: 'a@b.com', variables: {} })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
