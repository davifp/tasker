import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session/session';
import { setWorkspaceCookie } from '@/lib/session/workspace';
import { apiUrl } from '@/lib/http/backend';

interface SelectBody {
  slug?: unknown;
}

interface WorkspaceResponse {
  id: string;
  slug: string;
}

async function fetchWorkspace(
  slug: string,
  accessToken: string,
): Promise<WorkspaceResponse | null> {
  try {
    const response = await fetch(apiUrl(`/workspaces/${encodeURIComponent(slug)}`), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as WorkspaceResponse;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Unauthorized', status: 401 },
      { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  let body: SelectBody;
  try {
    body = (await request.json()) as SelectBody;
  } catch {
    return NextResponse.json(
      { type: 'about:blank', title: 'Invalid JSON body', status: 400 },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  if (typeof body.slug !== 'string' || body.slug.length === 0) {
    return NextResponse.json(
      {
        type: 'https://tasker.dev/problems/validation',
        title: 'Validation failed',
        status: 400,
        detail: 'slug is required',
      },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const workspace = await fetchWorkspace(body.slug, session.accessToken);
  if (!workspace) {
    return NextResponse.json(
      {
        type: 'https://tasker.dev/problems/not-found',
        title: 'Workspace not found',
        status: 404,
      },
      { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  await setWorkspaceCookie({ id: workspace.id, slug: workspace.slug });
  return NextResponse.json({ id: workspace.id, slug: workspace.slug });
}
