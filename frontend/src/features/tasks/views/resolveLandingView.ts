import type { ViewName } from '@/lib/http/viewPreferences';

const VIEWS: readonly ViewName[] = ['board', 'list', 'backlog', 'calendar', 'timeline'];

function isViewName(value: string | null | undefined): value is ViewName {
  return typeof value === 'string' && (VIEWS as readonly string[]).includes(value);
}

interface ResolveLandingViewArgs {
  urlView?: string | null;
  // Accept any string — the guard rejects unknown values. Allowing the
  // wider type means callers don't have to pre-narrow a raw fetch payload.
  serverDefaultView?: string | null;
}

/**
 * Precedence: explicit URL `?view=` → server `defaultView` → `'board'`.
 * Pure — safe to call from either a server component or a client hook.
 */
export function resolveLandingView({
  urlView,
  serverDefaultView,
}: ResolveLandingViewArgs): ViewName {
  if (isViewName(urlView)) return urlView;
  if (isViewName(serverDefaultView)) return serverDefaultView;
  return 'board';
}
