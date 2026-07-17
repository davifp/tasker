import { NextResponse } from 'next/server';
import { setSession } from '@/lib/session/session';
import { apiUrl } from '@/lib/http/backend';

interface OAuthCompleteBody {
  accessToken?: unknown;
  refreshToken?: unknown;
  redirectTo?: unknown;
}

interface MeResponse {
  id: string;
}

async function fetchUserId(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(apiUrl('/me'), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = (await response.json()) as MeResponse;
    return data.id ?? null;
  } catch {
    return null;
  }
}

function safeRedirect(candidate: unknown, fallback: string): string {
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback;
  }
  return candidate;
}

export async function POST(request: Request): Promise<Response> {
  let body: OAuthCompleteBody;
  try {
    body = (await request.json()) as OAuthCompleteBody;
  } catch {
    return NextResponse.json(
      { type: 'about:blank', title: 'Invalid JSON body', status: 400 },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  if (typeof body.accessToken !== 'string' || typeof body.refreshToken !== 'string') {
    return NextResponse.json(
      {
        type: 'https://tasker.dev/problems/validation',
        title: 'Validation failed',
        status: 400,
        detail: 'accessToken and refreshToken are required',
      },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const userId = await fetchUserId(body.accessToken);
  if (!userId) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Unauthorized', status: 401 },
      { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  await setSession({
    userId,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    accessExp: Math.floor(Date.now() / 1000) + 15 * 60,
  });

  const redirectTo = safeRedirect(body.redirectTo, '/');
  return NextResponse.json({ redirectTo });
}
