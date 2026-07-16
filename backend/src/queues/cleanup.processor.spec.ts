import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { CleanupProcessor } from './cleanup.processor';
import { CLEANUP_JOB, PURGE_WARNING_JOB } from './constants';

function makeJob(name: string, data: unknown = {}): Job {
  return { id: `${name}-1`, name, data } as unknown as Job;
}

describe('CleanupProcessor.runCleanup', () => {
  const now = new Date('2026-07-16T00:00:00Z');

  let emailVerificationToken: { deleteMany: ReturnType<typeof vi.fn> };
  let passwordResetToken: { deleteMany: ReturnType<typeof vi.fn> };
  let session: { deleteMany: ReturnType<typeof vi.fn> };
  let workspace: {
    deleteMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  let prisma: { forSystem: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };
  let mail: { send: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    emailVerificationToken = { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) };
    passwordResetToken = { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) };
    session = { deleteMany: vi.fn().mockResolvedValue({ count: 5 }) };
    workspace = {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
    };
    prisma = {
      forSystem: vi.fn().mockReturnValue({
        emailVerificationToken,
        passwordResetToken,
        session,
        workspace,
      }),
    };
    queue = { add: vi.fn().mockResolvedValue({ id: 'purge-warning-x' }) };
    mail = { send: vi.fn().mockResolvedValue({ jobId: 'mail-1' }) };
    config = {
      get: vi.fn((key: string, def: unknown) => {
        if (key === 'SESSION_RETENTION_DAYS') return 7;
        if (key === 'PURGE_WARNING_LEAD_DAYS') return 3;
        if (key === 'CLEANUP_CRON') return '0 3 * * *';
        return def;
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses expiresAt < now for token cleanup and expiresAt < now-retention for sessions', async () => {
    const processor = new CleanupProcessor(
      prisma as never,
      config as never,
      mail as never,
      queue as never,
    );

    const result = await processor.runCleanup(makeJob(CLEANUP_JOB) as never);

    expect(emailVerificationToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    });
    expect(passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: now } },
    });
    expect(session.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date('2026-07-09T00:00:00Z') } },
    });
    expect(workspace.deleteMany).toHaveBeenCalledWith({ where: { purgeAt: { lt: now } } });
    expect(result).toMatchObject({
      expiredTokens: { verification: 3, passwordReset: 2 },
      expiredSessions: 5,
      purgedWorkspaces: 1,
    });
  });

  it('does not throw when one pass fails — the failing count stays 0 and the job succeeds', async () => {
    session.deleteMany.mockRejectedValueOnce(new Error('boom'));
    const processor = new CleanupProcessor(
      prisma as never,
      config as never,
      mail as never,
      queue as never,
    );

    const result = await processor.runCleanup(makeJob(CLEANUP_JOB) as never);

    expect(result.expiredSessions).toBe(0);
    expect(result.expiredTokens.verification).toBe(3);
  });

  it('schedules a purge-warning job with a deterministic id per (workspaceId, purgeAt)', async () => {
    const purgeAt = new Date('2026-07-18T00:00:00Z'); // 2 days out; inside 3-day lead
    workspace.findMany.mockResolvedValueOnce([
      {
        id: 'ws-1',
        name: 'Acme',
        purgeAt,
        owner: { email: 'owner@acme.com' },
      },
    ]);

    const processor = new CleanupProcessor(
      prisma as never,
      config as never,
      mail as never,
      queue as never,
    );

    const result = await processor.runCleanup(makeJob(CLEANUP_JOB) as never);

    expect(queue.add).toHaveBeenCalledWith(
      PURGE_WARNING_JOB,
      expect.objectContaining({
        workspaceId: 'ws-1',
        workspaceName: 'Acme',
        ownerEmail: 'owner@acme.com',
        purgeAt: purgeAt.toISOString(),
      }),
      expect.objectContaining({ jobId: `purge-warning:ws-1:${purgeAt.toISOString()}` }),
    );
    expect(result.scheduledWarnings).toBe(1);
  });
});

describe('CleanupProcessor.process — purge-warning branch', () => {
  const purgeAt = new Date('2026-07-18T00:00:00Z');

  let prisma: { forSystem: ReturnType<typeof vi.fn> };
  let workspace: { findUnique: ReturnType<typeof vi.fn> };
  let mail: { send: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    workspace = { findUnique: vi.fn() };
    prisma = { forSystem: vi.fn().mockReturnValue({ workspace }) };
    mail = { send: vi.fn().mockResolvedValue({ jobId: 'mail-1' }) };
    config = { get: vi.fn((_k: string, def: unknown) => def) };
    queue = { add: vi.fn() };
  });

  it('sends the warning email when workspace still has the same purgeAt', async () => {
    workspace.findUnique.mockResolvedValueOnce({ purgeAt });

    const processor = new CleanupProcessor(
      prisma as never,
      config as never,
      mail as never,
      queue as never,
    );

    await processor.process(
      makeJob(PURGE_WARNING_JOB, {
        workspaceId: 'ws-1',
        workspaceName: 'Acme',
        ownerEmail: 'owner@acme.com',
        purgeAt: purgeAt.toISOString(),
      }),
    );

    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'workspace-purge-warning',
        to: 'owner@acme.com',
        idempotencyKey: `purge-warning-ws-1-${purgeAt.toISOString()}`,
      }),
    );
  });

  it('skips sending when the workspace was restored (purgeAt no longer matches)', async () => {
    workspace.findUnique.mockResolvedValueOnce({ purgeAt: null });

    const processor = new CleanupProcessor(
      prisma as never,
      config as never,
      mail as never,
      queue as never,
    );

    await processor.process(
      makeJob(PURGE_WARNING_JOB, {
        workspaceId: 'ws-1',
        workspaceName: 'Acme',
        ownerEmail: 'owner@acme.com',
        purgeAt: purgeAt.toISOString(),
      }),
    );

    expect(mail.send).not.toHaveBeenCalled();
  });
});
