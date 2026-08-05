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
  // Phase 7 — mutations captured via @Auditable interceptor.
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_DELETED: 'task.deleted',
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_DELETED: 'project.deleted',
  SPRINT_CREATED: 'sprint.created',
  SPRINT_UPDATED: 'sprint.updated',
  SPRINT_STARTED: 'sprint.started',
  SPRINT_COMPLETED: 'sprint.completed',
  API_KEY_ISSUED: 'apiKey.issued',
  API_KEY_REVOKED: 'apiKey.revoked',
  WEBHOOK_CREATED: 'webhook.created',
  WEBHOOK_UPDATED: 'webhook.updated',
  WEBHOOK_DELETED: 'webhook.deleted',
  WEBHOOK_SECRET_ROTATED: 'webhook.secret_rotated',
  WEBHOOK_DELIVERY_FAILED: 'webhook.delivery_failed',
  // Phase 7 — audit self-audit for CSV exports.
  AUDIT_EXPORT: 'audit.export',
  // Phase 9 — one row per AI invocation (success or failure). Metadata
  // carries the AuditAiMetadata payload (see AuditMetadataShape).
  AI_INVOCATION: 'ai.invocation',
  AI_CONSENT_ACCEPTED: 'ai.consent_accepted',
  AI_FEEDBACK_SUBMITTED: 'ai.feedback_submitted',
} as const;

export type AuditEventName = (typeof AuditEvent)[keyof typeof AuditEvent];
