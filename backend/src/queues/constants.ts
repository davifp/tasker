export const MAIL_QUEUE = 'mail' as const;
export const CLEANUP_QUEUE = 'cleanup' as const;

// Job names inside the cleanup queue.
export const CLEANUP_JOB = 'run' as const;
export const PURGE_WARNING_JOB = 'purge-warning' as const;
