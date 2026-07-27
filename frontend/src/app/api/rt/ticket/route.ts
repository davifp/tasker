import { NextResponse } from 'next/server';
import { getSession, setSession, clearSession } from '@/lib/session/session';
import { refreshBackend } from '@/lib/session/auth-backend';
import { apiUrl } from '@/lib/http/backend';

// Dedicated ticket route (rather than reusing /api/proxy/[...path]) because
// the WS ticket flow deserves its own tighter contract: never streams a body,
// returns 401 on a stale session so the client can trigger a session refresh
// instead of retrying the socket handshake.
export async function POST(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  async function callBackend(accessToken: string): Promise<Response> {
    return fetch(apiUrl('/realtime/ticket'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  }

  let upstream = await callBackend(session.accessToken);

  if (upstream.status === 401) {
    const refreshed = await refreshBackend(session.refreshToken);
    if (refreshed) {
      await setSession({
        userId: session.userId,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessExp: refreshed.accessExp,
      });
      upstream = await callBackend(refreshed.accessToken);
    } else {
      await clearSession();
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: 'ticket_failed' }, { status: upstream.status });
  }

  const body = (await upstream.json()) as { ticket: string; expiresAt: string };
  return NextResponse.json(body);
}
