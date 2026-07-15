import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpError, httpClient, addRequestInterceptor, clearInterceptors } from './http';

describe('HttpClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearInterceptors();
  });

  describe('2xx JSON unwrap', () => {
    it('returns typed data on successful GET', async () => {
      const data = { id: 1, name: 'test' };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await httpClient.get<typeof data>('/api/v1/test');

      expect(result).toEqual(data);
    });

    it('returns typed data on successful POST', async () => {
      const data = { created: true };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(data), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await httpClient.post<typeof data>('/api/v1/items', { name: 'new' });

      expect(result).toEqual(data);
    });
  });

  describe('application/problem+json error mapping', () => {
    it('parses problem+json body into HttpError', async () => {
      const problem = {
        type: 'https://tasker.dev/problems/not-found',
        title: 'Resource not found',
        status: 404,
        detail: 'The requested resource does not exist.',
        traceId: 'abc-123',
      };
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(problem), {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
      );

      await expect(httpClient.get('/api/v1/missing')).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof HttpError)) return false;
        expect(err.type).toBe(problem.type);
        expect(err.title).toBe(problem.title);
        expect(err.status).toBe(404);
        expect(err.traceId).toBe(problem.traceId);
        return true;
      });
    });

    it('throws HttpError with generic fields for non-problem non-2xx response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      await expect(httpClient.get('/api/v1/broken')).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof HttpError)) return false;
        expect(err.status).toBe(500);
        expect(err.type).toBe('about:blank');
        return true;
      });
    });
  });

  describe('request interceptors', () => {
    it('runs installed interceptor before outgoing request', async () => {
      const interceptor = vi.fn((init: RequestInit) => ({
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: 'Bearer token' },
      }));
      addRequestInterceptor(interceptor);

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await httpClient.get('/api/v1/protected');

      expect(interceptor).toHaveBeenCalledOnce();
      const calledInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
      const headers = calledInit.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer token');
    });
  });
});
