import type { TaskStatus } from '@prisma/client';

export interface TaskCreatedEvent {
  workspaceId: string;
  projectId: string;
  taskId: string;
  number: number;
  actorUserId: string;
  // The initial assignee (if any) travels with the event so the
  // notifications translator can raise a `TASK_ASSIGNED` bell entry
  // without a second DB round trip.
  assigneeUserId?: string | null;
}

export interface TaskUpdatedEvent {
  workspaceId: string;
  projectId: string;
  taskId: string;
  actorUserId: string;
  // Populated only when the update patch touched the assignee. Consumed by
  // the notifications translator to raise a `TASK_ASSIGNED` bell event for
  // the new assignee (and to clear the old one from the recipient set).
  assigneeDelta?: {
    previousUserId: string | null;
    currentUserId: string | null;
  };
}

export interface TaskMovedEvent {
  workspaceId: string;
  projectId: string;
  taskId: string;
  actorUserId: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
}

export interface TaskDeletedEvent {
  workspaceId: string;
  projectId: string;
  taskId: string;
  actorUserId: string;
  purgeAt: Date;
}

export interface TaskRestoredEvent {
  workspaceId: string;
  projectId: string;
  taskId: string;
  actorUserId: string;
}

export interface TaskDependencyAddedEvent {
  workspaceId: string;
  projectId: string;
  taskId: string;
  blockedByTaskId: string;
  actorUserId: string;
}

export interface TaskChecklistToggledEvent {
  workspaceId: string;
  projectId: string;
  taskId: string;
  itemId: string;
  checked: boolean;
  actorUserId: string;
}

export interface TaskCommentAddedEvent {
  workspaceId: string;
  projectId: string;
  taskId: string;
  commentId: string;
  actorUserId: string;
}

export const TaskEvents = {
  CREATED: 'task.created',
  UPDATED: 'task.updated',
  MOVED: 'task.moved',
  DELETED: 'task.deleted',
  RESTORED: 'task.restored',
  DEPENDENCY_ADDED: 'task.dependency-added',
  CHECKLIST_TOGGLED: 'task.checklist-toggled',
  COMMENT_ADDED: 'task.comment-added',
} as const;
