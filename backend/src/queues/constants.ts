export const MAIL_QUEUE = 'mail' as const;
export const CLEANUP_QUEUE = 'cleanup' as const;
export const NOTIFICATIONS_QUEUE = 'notifications' as const;
export const ATTACHMENTS_QUEUE = 'attachments' as const;

// Job names inside the cleanup queue.
export const CLEANUP_JOB = 'run' as const;
export const PURGE_WARNING_JOB = 'purge-warning' as const;

// Job names inside the notifications queue. Producer contract is frozen in
// `@tasker/config` (notificationJobSchema) so Phase 8 can swap the consumer
// without migrating producers.
export const COMMENT_MENTION_JOB = 'comment.mention' as const;

// Job names inside the attachments queue.
export const ATTACHMENTS_JANITOR_JOB = 'janitor' as const;
