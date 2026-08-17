import { NextResponse, type NextRequest } from 'next/server';
import { clearSession } from '@/lib/session/session';
import { clearWorkspaceCookie } from '@/lib/session/workspace';

// Auth invalidation redirect target for Server Components.
//
// Next.js restricts `cookies().set()` / `.delete()` to Server Actions and
// Route Handlers, so `verifySession()` in an RSC cannot destroy the cookie
// itself when the backend rejects the wrapped JWT. It signals invalidation
// by redirecting here; this handler runs in the Route Handler context where
// cookie mutation is allowed, destroys the iron-session + workspace cookies,
// and 303-redirects to `?next=...` (default `/login`). Never called from
// user-typed URLs — only from `redirect('/api/auth/expire?next=...')` inside
// RSC guards, so the missing-cookie case is harmless (idempotent destroy).
export async function GET(request: NextRequest): Promise<Response> {
  await clearSession();
  await clearWorkspaceCookie();

  const nextParam = request.nextUrl.searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/login';
  return NextResponse.redirect(new URL(next, request.nextUrl.origin), { status: 303 });
}
