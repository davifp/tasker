import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { AuditMutationInterceptor } from './audit-mutation.interceptor';
import { Auditable, AUDITABLE_META_KEY } from './auditable.decorator';
import { AuditEvent } from './audit.events';
import type { AuditService } from './audit.service';

function fakeContext(handler: () => void, cls: object = class {}) {
  const req: Record<string, unknown> = {
    method: 'POST',
    path: '/api/v1/workspaces/w1/projects/p1/tasks',
    params: { slug: 'w1', projectSlug: 'p1' },
    body: { title: 'New task', password: 'plaintext' },
    workspaceContext: { workspaceId: 'ws-1', userId: 'user-1' },
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  };
}

function makeAudit(): AuditService {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

async function drain<T>(stream: import('rxjs').Observable<T>): Promise<T[]> {
  const out: T[] = [];
  return await new Promise((resolve, reject) => {
    stream.subscribe({
      next: (v) => out.push(v),
      error: reject,
      complete: () => resolve(out),
    });
  });
}

describe('AuditMutationInterceptor', () => {
  let reflector: Reflector;
  let audit: AuditService;
  let interceptor: AuditMutationInterceptor;

  beforeEach(() => {
    reflector = new Reflector();
    audit = makeAudit();
    interceptor = new AuditMutationInterceptor(reflector, audit);
  });

  it('is a no-op when no @Auditable metadata is present', async () => {
    const handler = () => {};
    const next = { handle: () => of({ id: 'task-1' }) };
    const result = await drain(interceptor.intercept(fakeContext(handler), next));
    expect(result).toEqual([{ id: 'task-1' }]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records an audit entry after a 2xx result', async () => {
    const handler = () => {};
    Reflect.defineMetadata(
      AUDITABLE_META_KEY,
      {
        event: AuditEvent.TASK_CREATED,
        targetType: 'task',
        targetIdFrom: (_r: unknown, b: unknown) => (b as { id: string }).id,
      },
      handler,
    );

    const next = { handle: () => of({ id: 'task-42', title: 'X' }) };
    await drain(interceptor.intercept(fakeContext(handler), next));

    // record() is fire-and-forget from tap; give the microtask queue a tick.
    await new Promise((r) => setImmediate(r));
    expect(audit.record).toHaveBeenCalledTimes(1);
    const arg = (audit.record as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
      event: string;
      targetType: string;
      targetId: string;
      workspaceId: string;
      actorUserId: string;
      metadata: { body: Record<string, string> };
    };
    expect(arg.event).toBe(AuditEvent.TASK_CREATED);
    expect(arg.targetType).toBe('task');
    expect(arg.targetId).toBe('task-42');
    expect(arg.workspaceId).toBe('ws-1');
    expect(arg.actorUserId).toBe('user-1');
    expect(arg.metadata.body.password).toBe('[masked]');
  });

  it('does NOT record when the handler throws', async () => {
    const handler = () => {};
    Reflect.defineMetadata(
      AUDITABLE_META_KEY,
      { event: AuditEvent.TASK_CREATED, targetType: 'task' },
      handler,
    );
    const next = { handle: () => throwError(() => new Error('boom')) };
    await expect(drain(interceptor.intercept(fakeContext(handler), next))).rejects.toThrow('boom');
    await new Promise((r) => setImmediate(r));
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('swallows AuditService errors and lets the request complete', async () => {
    audit = { record: vi.fn().mockRejectedValue(new Error('db down')) } as unknown as AuditService;
    interceptor = new AuditMutationInterceptor(reflector, audit);
    const handler = () => {};
    Reflect.defineMetadata(
      AUDITABLE_META_KEY,
      { event: AuditEvent.TASK_CREATED, targetType: 'task' },
      handler,
    );
    const next = { handle: () => of({ id: 'x' }) };
    const result = await drain(interceptor.intercept(fakeContext(handler), next));
    expect(result).toEqual([{ id: 'x' }]);
    // No throw; the tap's error was caught internally.
  });

  it('exposes the Auditable() decorator that writes the same metadata key', () => {
    class DummyController {
      @Auditable({ event: AuditEvent.TASK_UPDATED, targetType: 'task' })
      handle() {}
    }
    const meta = Reflect.getMetadata(AUDITABLE_META_KEY, DummyController.prototype.handle);
    expect(meta).toEqual({ event: 'task.updated', targetType: 'task' });
  });
});
