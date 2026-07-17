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

export async function fetchMe(accessToken: string): Promise<CurrentUser | null> {
  try {
    const response = await fetch(apiUrl('/me'), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as CurrentUser;
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
    const data = (await response.json()) as
      { items?: WorkspaceMembership[] } | WorkspaceMembership[];
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  } catch {
    return [];
  }
}
