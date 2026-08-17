import { NextResponse, type NextRequest } from 'next/server';
import { clearSession } from '@/lib/session/session';
import { clearWorkspaceCookie } from '@/lib/session/workspace';

export async function GET(request: NextRequest): Promise<Response> {
  await clearSession();
  await clearWorkspaceCookie();

  const nextParam = request.nextUrl.searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/login';
  return NextResponse.redirect(new URL(next, request.nextUrl.origin), { status: 303 });
}
