import { z } from 'zod';

// ---------------------------------------------------------------------------
// Notification catalog — shared across producer, consumer and DB (Phase 8).
// Values are UPPER_SNAKE to match the Prisma enums 1:1, so a value read from
// `NotificationPreference.channel` can be fed to the Zod schema without a
// translation layer.
// ---------------------------------------------------------------------------

export const notificationEventTypeSchema = z.enum([
  'COMMENT_MENTION',
  'TASK_ASSIGNED',
  'COMMENT_FOLLOWED',
  'SPRINT_LIFECYCLE',
  'AI_BUDGET_THRESHOLD',
]);
export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;

export const notificationChannelSchema = z.enum(['IN_APP', 'EMAIL', 'PUSH']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationSourceKindSchema = z.enum(['TASK', 'COMMENT', 'SPRINT', 'WORKSPACE']);
export type NotificationSourceKind = z.infer<typeof notificationSourceKindSchema>;

// ---------------------------------------------------------------------------
// Realtime wire events. Discriminated union so the client can `switch` on
// `type` without runtime type guards. Sensitive fields (task description
// bodies, attachment filenames when the recipient lacks access) MUST be
// scrubbed by the server-side emitter before broadcasting.
// ---------------------------------------------------------------------------

const idSchema = z.string().min(1);

// `payload` is intentionally loose so services can pack the fields they
// touched without a schema migration. The emitter enforces per-recipient
// scrubbing; this schema only guarantees shape, not authorization.
const taskDeltaSchema = z.record(z.string(), z.unknown());

const taskEventSchema = z.object({
  type: z.enum(['task.updated', 'task.moved', 'task.deleted']),
  workspaceId: idSchema,
  taskId: idSchema,
  payload: taskDeltaSchema,
});

const commentEventSchema = z.object({
  type: z.enum(['comment.created', 'comment.updated', 'comment.deleted']),
  workspaceId: idSchema,
  taskId: idSchema,
  commentId: idSchema,
});

const activityAddedEventSchema = z.object({
  type: z.literal('activity.added'),
  workspaceId: idSchema,
  taskId: idSchema,
  entryId: idSchema,
});

const sprintUpdatedEventSchema = z.object({
  type: z.literal('sprint.updated'),
  workspaceId: idSchema,
  sprintId: idSchema,
  state: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED']),
});

const notificationNewEventSchema = z.object({
  type: z.literal('notification.new'),
  workspaceId: idSchema,
  recipientUserId: idSchema,
  notificationId: idSchema,
});

export const realtimeEventSchema = z.discriminatedUnion('type', [
  taskEventSchema,
  commentEventSchema,
  activityAddedEventSchema,
  sprintUpdatedEventSchema,
  notificationNewEventSchema,
]);
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

export const REALTIME_EVENT_TYPES = [
  'task.updated',
  'task.moved',
  'task.deleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'activity.added',
  'sprint.updated',
  'notification.new',
] as const;
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Subscribe messages (client → server). Kept minimal in v1: workspace room
// is auto-joined at connection time; explicit task subscription grants the
// finer-grained `task:<workspaceId>:<taskId>` room.
// ---------------------------------------------------------------------------

export const subscribeTaskMessageSchema = z.object({
  taskId: idSchema,
});
export type SubscribeTaskMessage = z.infer<typeof subscribeTaskMessageSchema>;

// ---------------------------------------------------------------------------
// WS ticket claims. Signed by the API with RT_TICKET_SECRET; jti is stored
// in Redis with a 60s TTL so the first successful verification burns it.
// ---------------------------------------------------------------------------

export const realtimeTicketClaimsSchema = z.object({
  sub: idSchema, // userId
  jti: idSchema,
  aud: z.literal('rt-ticket'),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type RealtimeTicketClaims = z.infer<typeof realtimeTicketClaimsSchema>;
