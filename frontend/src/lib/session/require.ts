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

export type AuthResult =
  | { status: 'authenticated'; session: SessionPayload; user: CurrentUser }
  | { status: 'expired' }
  | { status: 'unauthenticated' }
  | { status: 'error' };

export const verifySession = cache(async (): Promise<AuthResult> => {
  const session = await getSession();
  if (!session) return { status: 'unauthenticated' };
  const result = await fetchMeStatus(session.accessToken);
  if (result.status === 'unauthorized') return { status: 'expired' };
  if (result.status === 'error') return { status: 'error' };
  return { status: 'authenticated', session, user: result.data };
});

export const EXPIRE_PATH = '/api/auth/expire';

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

export async function requireSession(): Promise<SessionPayload> {
  const { session } = await requireVerified();
  return session;
}

export async function redirectIfAuthenticated(): Promise<void> {
  const verified = await verifySession();
  if (verified.status === 'authenticated') redirect('/');
  if (verified.status === 'expired') redirect(`${EXPIRE_PATH}?next=/login`);
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
