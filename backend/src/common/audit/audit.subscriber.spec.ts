import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditSubscriber } from './audit.subscriber';
import { AuditEvent } from './audit.events';

describe('AuditSubscriber', () => {
  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps USER_REGISTERED with actor + target both set to the new user id', async () => {
    const subscriber = new AuditSubscriber(audit as never);
    await subscriber.onUserRegistered({ userId: 'u-1', email: 'a@b.com' });

    expect(record).toHaveBeenCalledWith({
      event: AuditEvent.USER_REGISTERED,
      actorUserId: 'u-1',
      targetId: 'u-1',
      metadata: { email: 'a@b.com' },
    });
  });

  it('scrubs email from actor/target on LOGIN_FAILED — attacker cannot poison actor', async () => {
    const subscriber = new AuditSubscriber(audit as never);
    await subscriber.onLoginFailed({ email: 'a@b.com', reason: 'bad_credentials', ip: '1.2.3.4' });

    expect(record).toHaveBeenCalledWith({
      event: AuditEvent.LOGIN_FAILED,
      metadata: { email: 'a@b.com', reason: 'bad_credentials', ip: '1.2.3.4' },
    });
    const call = record.mock.calls[0][0];
    expect(call.actorUserId).toBeUndefined();
    expect(call.targetId).toBeUndefined();
  });

  it('maps MEMBERSHIP_ROLE_CHANGED with actor, target, workspace, and role deltas', async () => {
    const subscriber = new AuditSubscriber(audit as never);
    await subscriber.onMembershipRoleChanged({
      workspaceId: 'w-1',
      actorUserId: 'owner-1',
      targetUserId: 'member-1',
      previousRole: 'MEMBER',
      newRole: 'ADMIN',
    });

    expect(record).toHaveBeenCalledWith({
      event: AuditEvent.MEMBERSHIP_ROLE_CHANGED,
      actorUserId: 'owner-1',
      workspaceId: 'w-1',
      targetId: 'member-1',
      metadata: { previousRole: 'MEMBER', newRole: 'ADMIN' },
    });
  });

  it('maps WORKSPACE_DELETED with the purgeAt as an ISO string in metadata', async () => {
    const subscriber = new AuditSubscriber(audit as never);
    const purgeAt = new Date('2026-08-15T00:00:00Z');
    await subscriber.onWorkspaceDeleted({
      workspaceId: 'w-1',
      actorUserId: 'owner-1',
      purgeAt,
    });

    expect(record).toHaveBeenCalledWith({
      event: AuditEvent.WORKSPACE_DELETED,
      actorUserId: 'owner-1',
      workspaceId: 'w-1',
      targetId: 'w-1',
      metadata: { purgeAt: '2026-08-15T00:00:00.000Z' },
    });
  });

  it('maps INVITATION_CREATED carrying the refresh flag so re-invites are distinguishable', async () => {
    const subscriber = new AuditSubscriber(audit as never);
    await subscriber.onInvitationCreated({
      invitationId: 'i-1',
      workspaceId: 'w-1',
      invitedByUserId: 'admin-1',
      email: 'x@y.com',
      role: 'MEMBER',
      refreshed: true,
    });

    expect(record).toHaveBeenCalledWith({
      event: AuditEvent.INVITATION_CREATED,
      actorUserId: 'admin-1',
      workspaceId: 'w-1',
      targetId: 'i-1',
      metadata: { email: 'x@y.com', role: 'MEMBER', refreshed: true },
    });
  });
});
