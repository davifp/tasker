import { NextResponse } from 'next/server';
import { clearSession, getSession } from '@/lib/session/session';
import { clearWorkspaceCookie } from '@/lib/session/workspace';
import { logoutBackend } from '@/lib/session/auth-backend';

export async function POST(): Promise<Response> {
  const session = await getSession();
  if (session?.accessToken) {
    await logoutBackend(session.accessToken);
  }
  await clearSession();
  await clearWorkspaceCookie();
  return NextResponse.json({ ok: true });
}
