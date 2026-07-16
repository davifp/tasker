import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from './audit.service';
import { AuditEvent } from './audit.events';
import { TraceContext } from '../trace/trace-context';

describe('AuditService', () => {
  const auditLog = { create: vi.fn().mockResolvedValue(undefined) };
  const prisma = { forSystem: vi.fn().mockReturnValue({ auditLog }) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists an entry with actor, workspace, target, and metadata', async () => {
    const service = new AuditService(prisma as never);
    await service.record({
      event: AuditEvent.LOGIN_SUCCESS,
      actorUserId: 'u-1',
      workspaceId: 'w-1',
      targetId: 't-1',
      metadata: { ip: '1.2.3.4' },
    });

    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'login.success',
        actorUserId: 'u-1',
        workspaceId: 'w-1',
        targetId: 't-1',
        metadata: { ip: '1.2.3.4' },
      }),
    });
  });

  it('reads the traceId from the ambient TraceContext', async () => {
    const service = new AuditService(prisma as never);
    await TraceContext.run('trace-42', async () => {
      await service.record({ event: AuditEvent.USER_REGISTERED, actorUserId: 'u-1' });
    });

    expect(auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ traceId: 'trace-42' }) }),
    );
  });

  it('leaves traceId null when no TraceContext is active', async () => {
    const service = new AuditService(prisma as never);
    await service.record({ event: AuditEvent.USER_REGISTERED, actorUserId: 'u-1' });

    expect(auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ traceId: null }) }),
    );
  });

  it('does not throw when the write fails — audit must never break the caller', async () => {
    auditLog.create.mockRejectedValueOnce(new Error('db down'));
    const service = new AuditService(prisma as never);
    await expect(service.record({ event: AuditEvent.LOGIN_FAILED })).resolves.toBeUndefined();
  });
});
