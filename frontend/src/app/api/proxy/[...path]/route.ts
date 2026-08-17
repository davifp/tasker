import { NextResponse } from 'next/server';
import { clearSession, getSession, setSession } from '@/lib/session/session';
import { refreshBackend } from '@/lib/session/auth-backend';
import { getWorkspaceCookie } from '@/lib/session/workspace';
import { apiUrl } from '@/lib/http/backend';
import { issueCsrfCookie, isUnsafeMethod, validateCsrfHeader } from '@/lib/security/csrf';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

// Paths that operate across workspace boundaries — the caller may not (yet)
// be a member of the workspace stored in their cookie, so injecting
// X-Workspace-Id would trip WorkspaceGuard's membership check with a 403.
// The invitation-accept flow is the canonical example: the recipient
// redeems a token *before* their WorkspaceMember row exists.
// `workspaces/:slug/...` still needs the header (matches the URL slug); it's
// only the bare `workspaces` collection that is cross-workspace.
function isWorkspaceCrossing(path: string[]): boolean {
  const first = path[0] ?? '';
  if (first === 'invitations') return true;
  if (first === 'me') return true;
  if (first === 'auth') return true;
  if (first === 'workspaces' && path.length === 1) return true;
  return false;
}

function forwardHeaders(
  source: Headers,
  accessToken: string | undefined,
  workspaceId: string | undefined,
  crossWorkspace: boolean,
): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    if (key.toLowerCase() === 'cookie') return;
    if (key.toLowerCase() === 'authorization') return;
    headers.set(key, value);
  });
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  // Workspace-scoped endpoints without a `:slug` in the URL rely on the
  // X-Workspace-Id header to resolve WorkspaceGuard. Browser callers never
  // set it themselves (they only know the slug); we mirror the server-side
  // `serverHttp` behaviour and inject it from the workspace cookie unless
  // the client explicitly supplied one or the route is workspace-crossing.
  if (workspaceId && !headers.has('x-workspace-id') && !crossWorkspace) {
    headers.set('X-Workspace-Id', workspaceId);
  }
  headers.set('Accept', headers.get('Accept') ?? 'application/json');
  return headers;
}

function passthroughResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    if (key.toLowerCase() === 'set-cookie') return;
    headers.set(key, value);
  });
  return headers;
}

async function forward(request: Request, path: string[]): Promise<Response> {
  // Double-submit CSRF gate. Runs BEFORE the upstream call so a forged POST
  // never touches the backend even if the session cookie is valid. Only
  // enforced on mutating verbs — GETs read the CSRF cookie the same way any
  // browser tab does.
  if (isUnsafeMethod(request.method) && !validateCsrfHeader(request)) {
    return NextResponse.json(
      {
        type: 'https://tasker.dev/problems/csrf',
        title: 'CSRF token missing or invalid',
        status: 403,
      },
      { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const url = new URL(request.url);
  const upstreamPath = path.map((segment) => encodeURIComponent(segment)).join('/');
  const upstream = new URL(apiUrl(`/${upstreamPath}`));
  upstream.search = url.search;

  const session = await getSession();
  const workspace = await getWorkspaceCookie();
  const crossWorkspace = isWorkspaceCrossing(path);

  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  async function send(accessToken: string | undefined): Promise<Response> {
    const init: RequestInit = {
      method: request.method,
      headers: forwardHeaders(request.headers, accessToken, workspace?.id, crossWorkspace),
      body,
      cache: 'no-store',
      redirect: 'manual',
    };
    return fetch(upstream, init);
  }

  let upstreamResponse = await send(session?.accessToken);

  if (upstreamResponse.status === 401 && session) {
    const refreshed = await refreshBackend(session.refreshToken);
    if (refreshed) {
      await setSession({
        userId: session.userId,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessExp: refreshed.accessExp,
      });
      upstreamResponse = await send(refreshed.accessToken);
      if (upstreamResponse.status === 401) {
        await clearSession();
      }
    } else {
      await clearSession();
    }
  }

  const responseHeaders = passthroughResponseHeaders(upstreamResponse.headers);
  const proxyResponse = new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
  // Bootstrap the CSRF cookie for callers that don't have one yet (first
  // GET after a page load with a valid iron-session but expired CSRF).
  // Rotating per response would race concurrent requests (e.g. bell poll +
  // user POST): document.cookie reads and the outgoing Cookie header snap
  // to different tokens if a Set-Cookie lands between them. Login,
  // register, and oauth-complete still mint a fresh token on session
  // change — the leak window is per-session, not per-request.
  const cookieHeader = request.headers.get('cookie') ?? '';
  const hasCsrfCookie = cookieHeader.split(';').some((part) => part.trim().startsWith('tsk_csrf='));
  if (!hasCsrfCookie) {
    issueCsrfCookie(proxyResponse.cookies);
  }
  return proxyResponse;
}

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return forward(request, path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const HEAD = handle;
