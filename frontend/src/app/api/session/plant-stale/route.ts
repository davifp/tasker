import { NextResponse } from 'next/server';
import { setSession } from '@/lib/session/session';

export async function GET(): Promise<Response> {
  if (process.env['NODE_ENV'] === 'production') {
    return new NextResponse('Not Found', { status: 404 });
  }
  await setSession({
    userId: 'planted-stale-user',
    accessToken: 'planted.stale.jwt.that.backend.will.reject',
    refreshToken: 'planted.stale.refresh',
    accessExp: Math.floor(Date.now() / 1000) + 3600,
  });
  return NextResponse.json({ planted: true });
}
