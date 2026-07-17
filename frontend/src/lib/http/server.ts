import 'server-only';
import { HttpError } from './errors';
import { getSession } from '@/lib/session/session';
import { getWorkspaceCookie } from '@/lib/session/workspace';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ServerRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  workspaceId?: string;
  accessToken?: string;
}

export function backendBaseUrl(): string {
  return (
    process.env['INTERNAL_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
  );
}

function joinPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${backendBaseUrl()}${normalized}`;
}

export async function serverRequest<T>(
  path: string,
  options: ServerRequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers, signal, idempotencyKey } = options;

  const session = await getSession();
  const accessToken = options.accessToken ?? session?.accessToken;
  const workspace = await getWorkspaceCookie();
  const workspaceId = options.workspaceId ?? workspace?.id;

  const init: RequestInit = {
    method,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...headers,
    },
    signal,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(joinPath(path), init);

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

export const serverHttp = {
  get: <T>(path: string, options: Omit<ServerRequestOptions, 'method' | 'body'> = {}) =>
    serverRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(
    path: string,
    body?: unknown,
    options: Omit<ServerRequestOptions, 'method' | 'body'> = {},
  ) => serverRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(
    path: string,
    body?: unknown,
    options: Omit<ServerRequestOptions, 'method' | 'body'> = {},
  ) => serverRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options: Omit<ServerRequestOptions, 'method' | 'body'> = {}) =>
    serverRequest<T>(path, { ...options, method: 'DELETE' }),
};

export { HttpError };
