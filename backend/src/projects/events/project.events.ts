export interface ProjectCreatedEvent {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  slug: string;
}

export interface ProjectUpdatedEvent {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
}

export interface ProjectDeletedEvent {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  purgeAt: Date;
}

export interface ProjectRestoredEvent {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
}

export const ProjectEvents = {
  CREATED: 'project.created',
  UPDATED: 'project.updated',
  DELETED: 'project.deleted',
  RESTORED: 'project.restored',
} as const;
