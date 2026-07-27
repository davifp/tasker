import { NextResponse } from 'next/server';
import { getSession, setSession, clearSession } from '@/lib/session/session';
import { refreshBackend } from '@/lib/session/auth-backend';
import { apiUrl } from '@/lib/http/backend';

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await request.text();
  async function call(accessToken: string): Promise<Response> {
    return fetch(apiUrl('/push/subscriptions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
      cache: 'no-store',
    });
  }
  let upstream = await call(session.accessToken);
  if (upstream.status === 401) {
    const refreshed = await refreshBackend(session.refreshToken);
    if (refreshed) {
      await setSession({
        userId: session.userId,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessExp: refreshed.accessExp,
      });
      upstream = await call(refreshed.accessToken);
    } else {
      await clearSession();
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
    },
  });
}
