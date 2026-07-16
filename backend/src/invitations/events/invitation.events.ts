import type { WorkspaceRole } from '@prisma/client';

export interface InvitationCreatedEvent {
  invitationId: string;
  workspaceId: string;
  invitedByUserId: string;
  email: string;
  role: WorkspaceRole;
  refreshed: boolean;
}

export interface InvitationAcceptedEvent {
  invitationId: string;
  workspaceId: string;
  actorUserId: string;
  role: WorkspaceRole;
}

export interface InvitationDeclinedEvent {
  invitationId: string;
  workspaceId: string;
  email: string;
}

export interface InvitationRevokedEvent {
  invitationId: string;
  workspaceId: string;
  actorUserId: string;
}

export const InvitationEvents = {
  CREATED: 'invitation.created',
  ACCEPTED: 'invitation.accepted',
  DECLINED: 'invitation.declined',
  REVOKED: 'invitation.revoked',
} as const;
