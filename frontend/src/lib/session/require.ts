import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getSession, type SessionPayload } from './session';
import { apiUrl } from '@/lib/http/backend';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
}

export interface WorkspaceMembership {
  id: string;
  slug: string;
  name: string;
  role?: string;
}

interface BackendMeResponse {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: string | null;
}

interface BackendMembership {
  role?: string;
  workspace: { id: string; slug: string; name: string };
}

// Discriminated fetch result. Callers that gate rendering on auth need to
// distinguish "backend rejected the credentials" (destroy the cookie) from
// "transient failure" (keep the cookie, surface a normal error) — collapsing
// both into `null` was the cause of BUG-15's redirect loop.
type FetchResult<T> = { status: 'ok'; data: T } | { status: 'unauthorized' } | { status: 'error' };

async function fetchMeStatus(accessToken: string): Promise<FetchResult<CurrentUser>> {
  try {
    const response = await fetch(apiUrl('/me'), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) return { status: 'unauthorized' };
    if (!response.ok) return { status: 'error' };
    const raw = (await response.json()) as BackendMeResponse;
    return {
      status: 'ok',
      data: {
        id: raw.id,
        email: raw.email,
        name: raw.displayName,
        emailVerified: raw.emailVerifiedAt !== null,
      },
    };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Discriminated authentication state for RSC guards.
 *
 * `'expired'` means the iron-session cookie is intact but the backend
 * rejected the wrapped JWT — the caller must `redirect(EXPIRE_PATH)` so a
 * Route Handler destroys the cookie (Server Components cannot mutate
 * cookies in Next.js 15). `'unauthenticated'` means no cookie at all.
 * `'error'` means the backend was unreachable but the cookie may still be
 * valid — do not destroy.
 */
export type AuthResult =
  | { status: 'authenticated'; session: SessionPayload; user: CurrentUser }
  | { status: 'expired' }
  | { status: 'unauthenticated' }
  | { status: 'error' };

/**
 * Data Access Layer for authentication — Next.js's recommended pattern for
 * App Router. Reads the iron-session cookie, verifies the wrapped access
 * token against the backend once per request (deduped via `React.cache`),
 * and returns the authenticated user together with the session.
 *
 * Server Components cannot mutate cookies (Next.js constraint), so this
 * helper only *observes* the state — cookie destruction happens in the
 * `/api/auth/expire` Route Handler that callers redirect to.
 */
export const verifySession = cache(async (): Promise<AuthResult> => {
  const session = await getSession();
  if (!session) return { status: 'unauthenticated' };
  const result = await fetchMeStatus(session.accessToken);
  if (result.status === 'unauthorized') return { status: 'expired' };
  if (result.status === 'error') return { status: 'error' };
  return { status: 'authenticated', session, user: result.data };
});

/** Route Handler that destroys the iron-session cookie and redirects. */
export const EXPIRE_PATH = '/api/auth/expire';

/**
 * Standard RSC guard. Returns the authenticated principal, or redirects:
 *   - `expired` → `/api/auth/expire?next=/login` (destroys cookie first)
 *   - `unauthenticated` → `/login`
 *   - `error` → `/login` (best-effort; backend is unreachable)
 */
export async function requireVerified(): Promise<{
  session: SessionPayload;
  user: CurrentUser;
}> {
  const verified = await verifySession();
  if (verified.status === 'authenticated') {
    return { session: verified.session, user: verified.user };
  }
  if (verified.status === 'expired') {
    redirect(`${EXPIRE_PATH}?next=/login`);
  }
  redirect('/login');
}

/**
 * Legacy helper kept for the handful of RSCs that only need the session
 * payload (no user). Prefer `requireVerified()` for new call sites.
 */
export async function requireSession(): Promise<SessionPayload> {
  const { session } = await requireVerified();
  return session;
}

export async function fetchMe(accessToken: string): Promise<CurrentUser | null> {
  const result = await fetchMeStatus(accessToken);
  return result.status === 'ok' ? result.data : null;
}

export async function fetchMyWorkspaces(accessToken: string): Promise<WorkspaceMembership[]> {
  try {
    const response = await fetch(apiUrl('/me/workspaces'), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { items?: BackendMembership[] } | BackendMembership[];
    const items = Array.isArray(data) ? data : (data.items ?? []);
    return items.map((membership) => ({
      id: membership.workspace.id,
      slug: membership.workspace.slug,
      name: membership.workspace.name,
      role: membership.role,
    }));
  } catch {
    return [];
  }
}
