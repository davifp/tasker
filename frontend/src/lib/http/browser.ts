import { injectTraceparentHeaders, withClientSpan } from '@/observability/otel-web';
import { HttpError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

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

  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...traceHeaders,
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
