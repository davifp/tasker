export interface HttpClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
}

export class HttpError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly traceId?: string;

  constructor(data: {
    type: string;
    title: string;
    status: number;
    detail?: string;
    traceId?: string;
  }) {
    super(data.title);
    this.name = 'HttpError';
    this.type = data.type;
    this.title = data.title;
    this.status = data.status;
    this.detail = data.detail;
    this.traceId = data.traceId;
  }
}

type RequestInterceptor = (init: RequestInit) => RequestInit | Promise<RequestInit>;

const interceptors: RequestInterceptor[] = [];

export function addRequestInterceptor(interceptor: RequestInterceptor): void {
  interceptors.push(interceptor);
}

export function clearInterceptors(): void {
  interceptors.length = 0;
}

async function applyInterceptors(init: RequestInit): Promise<RequestInit> {
  let current = init;
  for (const interceptor of interceptors) {
    current = await interceptor(current);
  }
  return current;
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const intercepted = await applyInterceptors(init);
  const response = await fetch(url, {
    ...intercepted,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(intercepted.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/problem+json')) {
      const problem = (await response.json()) as {
        type?: string;
        title?: string;
        status?: number;
        detail?: string;
        traceId?: string;
      };
      throw new HttpError({
        type: problem.type ?? 'about:blank',
        title: problem.title ?? response.statusText,
        status: problem.status ?? response.status,
        detail: problem.detail,
        traceId: problem.traceId,
      });
    }
    throw new HttpError({
      type: 'about:blank',
      title: response.statusText,
      status: response.status,
    });
  }

  return response.json() as Promise<T>;
}

const baseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export const httpClient: HttpClient = {
  get<T>(path: string, init?: RequestInit): Promise<T> {
    return fetchJson<T>(`${baseUrl}${path}`, { ...init, method: 'GET' });
  },
  post<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
    return fetchJson<T>(`${baseUrl}${path}`, {
      ...init,
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};
