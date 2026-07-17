import { NextResponse } from 'next/server';
import { clearSession, getSession, refreshIfNeeded } from '@/lib/session/session';
import { refreshBackend } from '@/lib/session/auth-backend';

export async function POST(): Promise<Response> {
  const current = await getSession();
  if (!current) {
    return NextResponse.json(
      { type: 'about:blank', title: 'Unauthorized', status: 401 },
      { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const refreshed = await refreshIfNeeded(async (refreshToken) => {
    const tokens = await refreshBackend(refreshToken);
    if (!tokens) return null;
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExp: tokens.accessExp,
    };
  });

  if (!refreshed) {
    await clearSession();
    return NextResponse.json(
      { type: 'about:blank', title: 'Unauthorized', status: 401 },
      { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  return NextResponse.json({ userId: refreshed.userId, accessExp: refreshed.accessExp });
}
