export const MAIL_QUEUE = 'mail' as const;
export const CLEANUP_QUEUE = 'cleanup' as const;
export const NOTIFICATIONS_QUEUE = 'notifications' as const;
export const ATTACHMENTS_QUEUE = 'attachments' as const;
export const METRICS_QUEUE = 'metrics' as const;

// Job names inside the cleanup queue.
export const CLEANUP_JOB = 'run' as const;
export const PURGE_WARNING_JOB = 'purge-warning' as const;

// Job names inside the notifications queue. Producer contract is frozen in
// `@tasker/config` (notificationJobSchema) so Phase 8 can swap the consumer
// without migrating producers.
export const COMMENT_MENTION_JOB = 'comment.mention' as const;
export const NOTIFICATION_FANOUT_JOB = 'notification.fanout' as const;
export const NOTIFICATION_EMAIL_BATCH_JOB = 'notification.email-batch' as const;
export const NOTIFICATION_PUSH_JOB = 'notification.push' as const;

// Job names inside the attachments queue.
export const ATTACHMENTS_JANITOR_JOB = 'janitor' as const;

// Job names inside the metrics queue.
// - `refresh` — the repeatable global refresh that touches every matview.
// - `refresh:workspace` — on-demand workspace-scoped refresh triggered by
//   sprint lifecycle transitions and the debounced task-status listener.
export const METRICS_REFRESH_JOB_GLOBAL = 'refresh' as const;
export const METRICS_REFRESH_JOB_WORKSPACE = 'refresh:workspace' as const;
