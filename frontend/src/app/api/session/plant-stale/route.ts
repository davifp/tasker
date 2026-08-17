// QA-only helper: plants a valid iron-session cookie whose wrapped JWT the
// backend rejects with 401. Consumed by the redirect-loop regression suite
// in `e2e/route-protection.spec.ts` (BUG-15 fix from 2026-08-07).
//
// Guarded by NODE_ENV — returns 404 in production so a leaked route can't
// be used to plant credentials on a live user. Same shape as the
// test-only JWT_SECRET / RT_TICKET_SECRET fallbacks in playwright.config.ts.
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
