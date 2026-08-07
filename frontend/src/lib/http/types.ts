// Shared DTO shapes for the BFF clients. These mirror the backend
// contracts one-to-one — no field renames. Dates arrive as ISO strings
// (JSON) rather than Date objects; callers convert as needed.

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';
export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST' | 'DEMO_VIEWER';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Project {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  status: ProjectStatus;
  ownerUserId: string;
  createdByUserId: string;
  deletedAt: string | null;
  purgeAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  position: string;
  assigneeUserId: string | null;
  createdByUserId: string;
  startDate: string | null;
  dueDate: string | null;
  deletedAt: string | null;
  purgeAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Populated by list + detail endpoints; empty for create/update responses
  // that don't reload the labels join.
  labels?: TaskLabel[];
  // Populated by the list endpoint only. The drawer loads the full
  // checklist panel, so per-task fetch skips the aggregate.
  checklistDone?: number;
  checklistTotal?: number;
}

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
}

// Server-side move response. On the blocked branch the controller merges
// the task fields with the `acknowledgedBlockersOpen` array so a single
// 200 body covers both outcomes; consumers switch on the presence of the
// blocker list.
export interface MoveTaskResponse extends Task {
  acknowledgedBlockersOpen?: string[];
}

export interface Label {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  workspaceId: string;
  taskId: string;
  authorUserId: string;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Populated by Phase 5 endpoints. Older payloads may omit these fields.
  editedAt?: string | null;
  mentions?: Array<{ userId: string; offset: number }>;
}

export interface ChecklistItem {
  id: string;
  taskId: string;
  title: string;
  checked: boolean;
  position: string;
  createdAt: string;
}

export interface TaskDependency {
  taskId: string;
  blockedByTaskId: string;
}

// ---------------------------------------------------------------------------
// Collaboration (Phase 5): mentions, reactions, attachments, activity feed.
// Shapes mirror the backend one-to-one — see @tasker/config schemas + the
// service view types under backend/src/tasks/**/*.service.ts.
// ---------------------------------------------------------------------------

export interface MentionSuggestion {
  userId: string;
  displayName: string;
  slug: string;
  avatarUrl?: string | null;
}

export type AttachmentStatus = 'PENDING' | 'READY' | 'DELETING';

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  status: AttachmentStatus;
  uploaderUserId: string;
  createdAt: string;
}

export interface SignedUpload {
  attachmentId: string;
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactorSample: Array<{ userId: string; displayName: string }>;
  reactedByMe: boolean;
}

export type ActivityVerb =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.status_changed'
  | 'comment.created'
  | 'comment.edited'
  | 'comment.deleted'
  | 'reaction.added'
  | 'reaction.removed'
  | 'attachment.uploaded'
  | 'attachment.removed';

export interface ActivityPayload {
  actorDisplayName?: string;
  targetTitle?: string;
  from?: string;
  to?: string;
  commentId?: string;
  commentExcerpt?: string;
  emoji?: string;
  attachmentId?: string;
  attachmentFilename?: string;
}

export interface Activity {
  id: string;
  workspaceId: string;
  projectId: string;
  taskId: string | null;
  actorUserId: string | null;
  verb: ActivityVerb;
  payload: ActivityPayload;
  createdAt: string;
}
