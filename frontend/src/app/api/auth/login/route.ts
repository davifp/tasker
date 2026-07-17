import { NextResponse } from 'next/server';
import { loginBackend } from '@/lib/session/auth-backend';
import { setSession } from '@/lib/session/session';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json(
      { type: 'about:blank', title: 'Invalid JSON body', status: 400 },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json(
      {
        type: 'https://tasker.dev/problems/validation',
        title: 'Validation failed',
        status: 400,
        detail: 'email and password are required',
      },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const result = await loginBackend({ email: body.email, password: body.password });
  if (!result.ok) {
    const body = await result.response.text();
    return new Response(body, {
      status: result.response.status,
      headers: {
        'Content-Type': result.response.headers.get('Content-Type') ?? 'application/problem+json',
      },
    });
  }

  await setSession(result.session);
  return NextResponse.json({ userId: result.session.userId });
}
