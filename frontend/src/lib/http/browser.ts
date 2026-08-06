import { injectTraceparentHeaders, withClientSpan } from '@/observability/otel-web';
import { HttpError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

// Canonical name for the double-submit CSRF cookie issued by the Next.js
// proxy on session establishment (see /api/proxy/[...path]/route.ts).
export const CSRF_COOKIE_NAME = 'tsk_csrf';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';
const UNSAFE_METHODS = new Set<HttpMethod>(['POST', 'PATCH', 'PUT', 'DELETE']);

function readCsrfCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const raw = document.cookie;
  if (!raw) return undefined;
  const prefix = `${CSRF_COOKIE_NAME}=`;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      return trimmed.slice(prefix.length);
    }
  }
  return undefined;
}

export interface BrowserRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

const PROXY_BASE = '/api/proxy';

function buildUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${PROXY_BASE}${normalized}`;
}

export async function browserRequest<T>(
  path: string,
  options: BrowserRequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers, signal, idempotencyKey } = options;

  // Serialize the active OTel-web span into a W3C `traceparent` (and
  // `tracestate` if present) so the backend request span shares the same
  // trace ID as the browser interaction that triggered it. If OTel-web has
  // not been initialized yet (test environments, SSR paths, or pre-hydration
  // work) the injector is a no-op and the backend mints its own root span.
  const traceHeaders: Record<string, string> = {};
  withClientSpan(`http.${method.toLowerCase()} ${path}`, () => {
    injectTraceparentHeaders(traceHeaders);
  });

  // Double-submit CSRF: on mutating verbs, read the `tsk_csrf` cookie set by
  // the proxy on session establishment and echo it back as `X-CSRF-Token`.
  // The proxy compares the two — a cross-origin attacker cannot read the
  // cookie (same-origin) and therefore cannot forge the header.
  const csrfHeaders: Record<string, string> = {};
  if (UNSAFE_METHODS.has(method)) {
    const token = readCsrfCookie();
    if (token) csrfHeaders[CSRF_HEADER_NAME] = token;
  }

  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...traceHeaders,
      ...csrfHeaders,
      ...headers,
    },
    signal,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path), init);

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const browserHttp = {
  get: <T>(path: string, options: Omit<BrowserRequestOptions, 'method' | 'body'> = {}) =>
    browserRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(
    path: string,
    body?: unknown,
    options: Omit<BrowserRequestOptions, 'method' | 'body'> = {},
  ) => browserRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(
    path: string,
    body?: unknown,
    options: Omit<BrowserRequestOptions, 'method' | 'body'> = {},
  ) => browserRequest<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(
    path: string,
    body?: unknown,
    options: Omit<BrowserRequestOptions, 'method' | 'body'> = {},
  ) => browserRequest<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options: Omit<BrowserRequestOptions, 'method' | 'body'> = {}) =>
    browserRequest<T>(path, { ...options, method: 'DELETE' }),
};

export { HttpError };
