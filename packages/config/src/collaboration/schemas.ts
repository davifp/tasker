import { z } from 'zod';
import { REACTIONS_CATALOG } from './reactions-catalog';
import { ATTACHMENT_MAX_BYTES, isAllowedAttachmentMime } from './attachment-policy';

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const commentBodySchema = z.string().trim().min(1).max(10_000);

export const createCommentSchema = z.object({
  body: commentBodySchema,
});

export const updateCommentSchema = z.object({
  body: commentBodySchema,
});

// Cursor pagination is a base64url-encoded opaque string; kept as a bounded
// string here so the DTO layer rejects oversized junk without decoding.
const cursorSchema = z.string().min(1).max(512).optional();
const pageLimitSchema = z.coerce.number().int().min(1).max(100).default(50);

export const listCommentsQuerySchema = z.object({
  cursor: cursorSchema,
  limit: pageLimitSchema,
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

export const reactionEmojiSchema = z.enum(REACTIONS_CATALOG);

export const reactionParamSchema = z.object({
  emoji: reactionEmojiSchema,
});

export type ReactionEmojiInput = z.infer<typeof reactionEmojiSchema>;

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

// Matches @handle in Markdown source. Kept in the shared package so backend
// (MentionParser) and frontend (MentionPopover trigger) agree on the exact
// character class.
export const MENTION_HANDLE_REGEXP: RegExp = /(?:^|[\s(>])@([a-zA-Z0-9._-]{1,64})/g;

export const mentionAutocompleteQuerySchema = z.object({
  q: z.string().trim().min(0).max(64).default(''),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export type MentionAutocompleteQuery = z.infer<typeof mentionAutocompleteQuerySchema>;

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

// Filenames get a soft size cap to keep the DB row small; the object storage
// key is derived server-side and never trusts client input.
export const attachmentFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // Reject path traversal / NUL / newline characters — the storage adapter
  // still owns key generation, but rejecting here keeps error messages clean.
  .refine((v) => !v.includes('/') && !v.includes('\\') && !v.includes('\0') && !v.includes('\n'), {
    message: 'Filename contains disallowed characters',
  });

export const signAttachmentSchema = z.object({
  filename: attachmentFilenameSchema,
  mime: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(isAllowedAttachmentMime, { message: 'Mime type not allowed' }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(ATTACHMENT_MAX_BYTES, { message: 'File exceeds maximum size' }),
});

export const listAttachmentsQuerySchema = z.object({
  cursor: cursorSchema,
  limit: pageLimitSchema,
});

export type SignAttachmentInput = z.infer<typeof signAttachmentSchema>;
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export const ACTIVITY_VERBS = [
  'task.created',
  'task.updated',
  'task.deleted',
  'task.status_changed',
  'comment.created',
  'comment.edited',
  'comment.deleted',
  'reaction.added',
  'reaction.removed',
  'attachment.uploaded',
  'attachment.removed',
  // Planning (Fase 6).
  'sprint.created',
  'sprint.started',
  'sprint.completed',
  'sprint.task_added',
  'sprint.task_removed',
  'epic.created',
  'epic.updated',
  'epic.deleted',
] as const;

export const activityVerbSchema = z.enum(ACTIVITY_VERBS);

export const listActivityQuerySchema = z.object({
  cursor: cursorSchema,
  limit: pageLimitSchema,
});

export type ActivityVerb = z.infer<typeof activityVerbSchema>;
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;

// ---------------------------------------------------------------------------
// Notifications queue payloads (Phase 8 substrate)
// ---------------------------------------------------------------------------

/**
 * Producer contract frozen here so Phase 8 can swap the consumer without
 * having to migrate every mention-emitting producer. Keep this schema
 * additive-only — new fields must be optional.
 */
export const notificationJobSchema = z.object({
  type: z.literal('comment.mention'),
  workspaceId: z.string().min(1),
  commentId: z.string().min(1),
  taskId: z.string().min(1),
  mentionedUserId: z.string().min(1),
  actorUserId: z.string().min(1),
});

export type NotificationJob = z.infer<typeof notificationJobSchema>;
