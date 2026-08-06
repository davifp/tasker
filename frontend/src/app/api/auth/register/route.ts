import { NextResponse } from 'next/server';
import { registerBackend } from '@/lib/session/auth-backend';
import { setSession } from '@/lib/session/session';
import { issueCsrfCookie } from '@/lib/security/csrf';

interface RegisterBody {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json(
      { type: 'about:blank', title: 'Invalid JSON body', status: 400 },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  if (
    typeof body.email !== 'string' ||
    typeof body.password !== 'string' ||
    typeof body.name !== 'string'
  ) {
    return NextResponse.json(
      {
        type: 'https://tasker.dev/problems/validation',
        title: 'Validation failed',
        status: 400,
        detail: 'email, password and name are required',
      },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const result = await registerBackend({
    email: body.email,
    password: body.password,
    name: body.name,
  });
  if (!result.ok) {
    const raw = await result.response.text();
    return new Response(raw, {
      status: result.response.status,
      headers: {
        'Content-Type': result.response.headers.get('Content-Type') ?? 'application/problem+json',
      },
    });
  }

  await setSession(result.session);
  const response = NextResponse.json({ userId: result.session.userId });
  issueCsrfCookie(response.cookies);
  return response;
}
