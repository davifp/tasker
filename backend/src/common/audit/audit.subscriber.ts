import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AuthEvents,
  LoginFailedEvent,
  LoginSuccessEvent,
  PasswordResetCompletedEvent,
  PasswordResetRequestedEvent,
  UserRegisteredEvent,
} from '../../auth/events/auth.events';
import {
  InvitationAcceptedEvent,
  InvitationCreatedEvent,
  InvitationDeclinedEvent,
  InvitationEvents,
  InvitationRevokedEvent,
} from '../../invitations/events/invitation.events';
import {
  MembershipRemovedEvent,
  MembershipRoleChangedEvent,
  WorkspaceDeletedEvent,
  WorkspaceEvents,
  WorkspaceOwnershipTransferredEvent,
  WorkspaceRestoredEvent,
} from '../../workspaces/events/workspace.events';
import { AuditEvent } from './audit.events';
import { AuditService } from './audit.service';

// Chosen: EventEmitter-based subscriber (vs. an APP_INTERCEPTOR).
// Justification: audit entries need semantic details (previousRole, refreshed,
// revokedSessionCount) that don't naturally live on the HTTP boundary — they
// belong to the domain services that already emit typed events. A subscriber
// keeps the audit surface additive and lets us cover non-HTTP producers (BullMQ
// workers, cron) later without a second mechanism.
@Injectable()
export class AuditSubscriber {
  constructor(private readonly audit: AuditService) {}

  @OnEvent(AuthEvents.USER_REGISTERED, { async: true })
  onUserRegistered(event: UserRegisteredEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.USER_REGISTERED,
      actorUserId: event.userId,
      targetId: event.userId,
      metadata: { email: event.email },
    });
  }

  @OnEvent(AuthEvents.LOGIN_SUCCESS, { async: true })
  onLoginSuccess(event: LoginSuccessEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.LOGIN_SUCCESS,
      actorUserId: event.userId,
      targetId: event.userId,
      metadata: event.ip ? { ip: event.ip } : {},
    });
  }

  @OnEvent(AuthEvents.LOGIN_FAILED, { async: true })
  onLoginFailed(event: LoginFailedEvent): Promise<void> {
    // Deliberately do NOT record the submitted email as actor/target — that
    // would let attackers seed the audit log with fake identities. Email lives
    // in metadata so operators can correlate without treating it as verified.
    return this.audit.record({
      event: AuditEvent.LOGIN_FAILED,
      metadata: { email: event.email, reason: event.reason, ...(event.ip ? { ip: event.ip } : {}) },
    });
  }

  @OnEvent(AuthEvents.PASSWORD_RESET_REQUESTED, { async: true })
  onPasswordResetRequested(event: PasswordResetRequestedEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.PASSWORD_RESET_REQUESTED,
      actorUserId: event.userId,
      targetId: event.userId,
      metadata: { email: event.email },
    });
  }

  @OnEvent(AuthEvents.PASSWORD_RESET_COMPLETED, { async: true })
  onPasswordResetCompleted(event: PasswordResetCompletedEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.PASSWORD_RESET_COMPLETED,
      actorUserId: event.userId,
      targetId: event.userId,
      metadata: { revokedSessionCount: event.revokedSessionCount },
    });
  }

  @OnEvent(WorkspaceEvents.MEMBERSHIP_ROLE_CHANGED, { async: true })
  onMembershipRoleChanged(event: MembershipRoleChangedEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.MEMBERSHIP_ROLE_CHANGED,
      actorUserId: event.actorUserId,
      workspaceId: event.workspaceId,
      targetId: event.targetUserId,
      metadata: { previousRole: event.previousRole, newRole: event.newRole },
    });
  }

  @OnEvent(WorkspaceEvents.MEMBERSHIP_REMOVED, { async: true })
  onMembershipRemoved(event: MembershipRemovedEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.MEMBERSHIP_REMOVED,
      actorUserId: event.actorUserId,
      workspaceId: event.workspaceId,
      targetId: event.targetUserId,
      metadata: { previousRole: event.previousRole, selfLeave: event.selfLeave },
    });
  }

  @OnEvent(WorkspaceEvents.DELETED, { async: true })
  onWorkspaceDeleted(event: WorkspaceDeletedEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.WORKSPACE_DELETED,
      actorUserId: event.actorUserId,
      workspaceId: event.workspaceId,
      targetId: event.workspaceId,
      metadata: { purgeAt: event.purgeAt.toISOString() },
    });
  }

  @OnEvent(WorkspaceEvents.RESTORED, { async: true })
  onWorkspaceRestored(event: WorkspaceRestoredEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.WORKSPACE_RESTORED,
      actorUserId: event.actorUserId,
      workspaceId: event.workspaceId,
      targetId: event.workspaceId,
    });
  }

  @OnEvent(WorkspaceEvents.OWNERSHIP_TRANSFERRED, { async: true })
  onOwnershipTransferred(event: WorkspaceOwnershipTransferredEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.WORKSPACE_OWNERSHIP_TRANSFERRED,
      actorUserId: event.previousOwnerUserId,
      workspaceId: event.workspaceId,
      targetId: event.newOwnerUserId,
      metadata: {
        previousOwnerUserId: event.previousOwnerUserId,
        newOwnerUserId: event.newOwnerUserId,
      },
    });
  }

  @OnEvent(InvitationEvents.CREATED, { async: true })
  onInvitationCreated(event: InvitationCreatedEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.INVITATION_CREATED,
      actorUserId: event.invitedByUserId,
      workspaceId: event.workspaceId,
      targetId: event.invitationId,
      metadata: { email: event.email, role: event.role, refreshed: event.refreshed },
    });
  }

  @OnEvent(InvitationEvents.ACCEPTED, { async: true })
  onInvitationAccepted(event: InvitationAcceptedEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.INVITATION_ACCEPTED,
      actorUserId: event.actorUserId,
      workspaceId: event.workspaceId,
      targetId: event.invitationId,
      metadata: { role: event.role },
    });
  }

  @OnEvent(InvitationEvents.DECLINED, { async: true })
  onInvitationDeclined(event: InvitationDeclinedEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.INVITATION_DECLINED,
      workspaceId: event.workspaceId,
      targetId: event.invitationId,
      metadata: { email: event.email },
    });
  }

  @OnEvent(InvitationEvents.REVOKED, { async: true })
  onInvitationRevoked(event: InvitationRevokedEvent): Promise<void> {
    return this.audit.record({
      event: AuditEvent.INVITATION_REVOKED,
      actorUserId: event.actorUserId,
      workspaceId: event.workspaceId,
      targetId: event.invitationId,
    });
  }
}
