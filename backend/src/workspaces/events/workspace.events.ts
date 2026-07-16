import type { WorkspaceRole } from '@prisma/client';

export interface WorkspaceDeletedEvent {
  workspaceId: string;
  actorUserId: string;
  purgeAt: Date;
}

export interface WorkspaceRestoredEvent {
  workspaceId: string;
  actorUserId: string;
}

export interface WorkspaceOwnershipTransferredEvent {
  workspaceId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
}

export interface MembershipRoleChangedEvent {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  previousRole: WorkspaceRole;
  newRole: WorkspaceRole;
}

export interface MembershipRemovedEvent {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  previousRole: WorkspaceRole;
  selfLeave: boolean;
}

export const WorkspaceEvents = {
  DELETED: 'workspace.deleted',
  RESTORED: 'workspace.restored',
  OWNERSHIP_TRANSFERRED: 'workspace.ownership_transferred',
  MEMBERSHIP_ROLE_CHANGED: 'workspace.membership.role_changed',
  MEMBERSHIP_REMOVED: 'workspace.membership.removed',
} as const;
