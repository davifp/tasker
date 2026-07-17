import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session/session';
import { getWorkspaceCookie } from '@/lib/session/workspace';
import { apiUrl } from '@/lib/http/backend';

interface MeResponse {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
}

interface WorkspaceListItem {
  id: string;
  slug: string;
  name: string;
  role?: string;
}

async function fetchMe(accessToken: string): Promise<MeResponse | null> {
  try {
    const response = await fetch(apiUrl('/me'), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as MeResponse;
  } catch {
    return null;
  }
}

async function fetchWorkspaces(accessToken: string): Promise<WorkspaceListItem[]> {
  try {
    const response = await fetch(apiUrl('/me/workspaces'), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { items?: WorkspaceListItem[] } | WorkspaceListItem[];
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  } catch {
    return [];
  }
}

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null, workspaces: [], currentWorkspace: null });
  }

  const [user, workspaces] = await Promise.all([
    fetchMe(session.accessToken),
    fetchWorkspaces(session.accessToken),
  ]);

  const currentSlug = (await getWorkspaceCookie())?.slug;
  const currentWorkspace = currentSlug
    ? (workspaces.find((workspace) => workspace.slug === currentSlug) ?? null)
    : null;

  return NextResponse.json({ user, workspaces, currentWorkspace });
}
