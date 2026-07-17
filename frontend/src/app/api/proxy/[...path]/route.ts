import { clearSession, getSession, setSession } from '@/lib/session/session';
import { refreshBackend } from '@/lib/session/auth-backend';
import { apiUrl } from '@/lib/http/backend';

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

function forwardHeaders(source: Headers, accessToken: string | undefined): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    if (key.toLowerCase() === 'cookie') return;
    if (key.toLowerCase() === 'authorization') return;
    headers.set(key, value);
  });
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
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
  const url = new URL(request.url);
  const upstreamPath = path.map((segment) => encodeURIComponent(segment)).join('/');
  const upstream = new URL(apiUrl(`/${upstreamPath}`));
  upstream.search = url.search;

  const session = await getSession();

  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  async function send(accessToken: string | undefined): Promise<Response> {
    const init: RequestInit = {
      method: request.method,
      headers: forwardHeaders(request.headers, accessToken),
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
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
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
