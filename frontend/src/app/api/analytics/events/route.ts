import { NextResponse } from 'next/server';
import { AnalyticsBatchSchema } from '@/features/analytics/emitter';
import { getSession } from '@/lib/session/session';
import { getWorkspaceCookie } from '@/lib/session/workspace';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { type: 'about:blank', title: 'Invalid JSON body', status: 400 },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const parsed = AnalyticsBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        type: 'https://tasker.dev/problems/validation',
        title: 'Validation failed',
        status: 400,
        detail: parsed.error.issues[0]?.message,
      },
      { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const [session, workspace] = await Promise.all([getSession(), getWorkspaceCookie()]);
  const traceId = request.headers.get('x-request-id') ?? undefined;

  for (const event of parsed.data.events) {
    const { name, ...props } = event;
    console.info(
      JSON.stringify({
        source: 'analytics',
        event: name,
        userId: session?.userId,
        workspaceId: workspace?.id,
        traceId,
        props,
      }),
    );
  }

  return NextResponse.json({ received: parsed.data.events.length }, { status: 202 });
}
