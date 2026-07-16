// Canonical event names written to AuditLog.event. Distinct from the
// EventEmitter topic names so AuditLog stays stable if we later rename topics.
export const AuditEvent = {
  USER_REGISTERED: 'user.registered',
  LOGIN_SUCCESS: 'login.success',
  LOGIN_FAILED: 'login.failed',
  PASSWORD_RESET_REQUESTED: 'password.reset_requested',
  PASSWORD_RESET_COMPLETED: 'password.reset_completed',
  MEMBERSHIP_ROLE_CHANGED: 'membership.role_changed',
  MEMBERSHIP_REMOVED: 'membership.removed',
  WORKSPACE_DELETED: 'workspace.deleted',
  WORKSPACE_RESTORED: 'workspace.restored',
  WORKSPACE_OWNERSHIP_TRANSFERRED: 'workspace.ownership_transferred',
  INVITATION_CREATED: 'invitation.created',
  INVITATION_ACCEPTED: 'invitation.accepted',
  INVITATION_DECLINED: 'invitation.declined',
  INVITATION_REVOKED: 'invitation.revoked',
} as const;

export type AuditEventName = (typeof AuditEvent)[keyof typeof AuditEvent];
