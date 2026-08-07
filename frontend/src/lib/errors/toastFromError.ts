import { toast } from 'sonner';
import { HttpError } from '@/lib/http/errors';

// Maps RFC 7807 problem type URLs the backend emits (see
// backend/src/common/context/*.guard.ts and problem-details.filter.ts)
// to short, user-facing copy. Anything not in this map falls back to a
// generic message per HTTP status class so we never leak raw guard
// strings like "This action requires one of: ADMIN. Your role: DEMO_VIEWER."
const PROBLEM_TYPE_MESSAGES: Record<string, string> = {
  'https://tasker.dev/problems/demo-read-only':
    'The public demo is read-only. Sign up to create your own workspace.',
  'https://tasker.dev/problems/insufficient-role':
    "You don't have permission to do that. Ask a workspace admin.",
  'https://tasker.dev/problems/workspace-context-missing':
    'This action needs a workspace. Pick or create one first.',
  'https://tasker.dev/problems/health-degraded':
    'The service is temporarily degraded. Please try again in a moment.',
};

function fallbackForStatus(status: number, defaultMessage: string): string {
  if (status === 400) return 'Some of the details are invalid. Check the highlighted fields.';
  if (status === 401) return 'Your session expired. Sign in again to continue.';
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "We couldn't find what you were looking for.";
  if (status === 409) return 'That conflicts with the current state. Refresh and try again.';
  if (status === 422) return 'Some of the details are invalid. Check the highlighted fields.';
  if (status === 429) return 'Too many requests. Slow down and try again.';
  if (status >= 500) return "Something went wrong on our side. We're on it — please retry.";
  return defaultMessage;
}

export function messageFromError(err: unknown, defaultMessage: string): string {
  if (err instanceof HttpError) {
    const byType = PROBLEM_TYPE_MESSAGES[err.type];
    if (byType) return byType;
    return fallbackForStatus(err.status, defaultMessage);
  }
  return defaultMessage;
}

export function toastFromError(err: unknown, defaultMessage: string): void {
  toast.error(messageFromError(err, defaultMessage));
}
