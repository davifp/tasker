import { NextResponse } from 'next/server';
import { getSession, setSession, clearSession } from '@/lib/session/session';
import { refreshBackend } from '@/lib/session/auth-backend';
import { apiUrl } from '@/lib/http/backend';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ endpoint: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { endpoint } = await params;
  async function call(accessToken: string): Promise<Response> {
    return fetch(apiUrl(`/push/subscriptions/${endpoint}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
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
  return new NextResponse(null, { status: upstream.status });
}
