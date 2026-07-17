import { HttpError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface BffRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function normalizePath(path: string): string {
  if (path.startsWith('/api/')) return path;
  if (path.startsWith('/')) return `/api${path}`;
  return `/api/${path}`;
}

export async function bffRequest<T>(path: string, options: BffRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers, signal } = options;
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    signal,
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const response = await fetch(normalizePath(path), init);
  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) return undefined as T;
  return (await response.json()) as T;
}

export const bff = {
  get: <T>(path: string, options: Omit<BffRequestOptions, 'method' | 'body'> = {}) =>
    bffRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(
    path: string,
    body?: unknown,
    options: Omit<BffRequestOptions, 'method' | 'body'> = {},
  ) => bffRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(
    path: string,
    body?: unknown,
    options: Omit<BffRequestOptions, 'method' | 'body'> = {},
  ) => bffRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options: Omit<BffRequestOptions, 'method' | 'body'> = {}) =>
    bffRequest<T>(path, { ...options, method: 'DELETE' }),
};
