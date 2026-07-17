import 'server-only';
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

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
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

export async function fetchMe(accessToken: string): Promise<CurrentUser | null> {
  try {
    const response = await fetch(apiUrl('/me'), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const raw = (await response.json()) as BackendMeResponse;
    return {
      id: raw.id,
      email: raw.email,
      name: raw.displayName,
      emailVerified: raw.emailVerifiedAt !== null,
    };
  } catch {
    return null;
  }
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
