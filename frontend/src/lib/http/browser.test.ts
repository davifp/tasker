import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpError, browserHttp, browserRequest } from './browser';
import { __resetOtelWebForTests, initOtelWeb } from '@/observability/otel-web';

describe('browserHttp', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    __resetOtelWebForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    __resetOtelWebForTests();
  });

  it('targets /api/proxy and returns json on 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await browserHttp.get<{ ok: boolean }>('/me');

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/proxy/me',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('forwards Idempotency-Key when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await browserHttp.post('/workspaces', { name: 'demo' }, { idempotencyKey: 'k-1' });

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('k-1');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('returns undefined on 204 with no body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await browserHttp.delete('/workspaces/x');
    expect(result).toBeUndefined();
  });

  it('parses problem+json into HttpError', async () => {
    const problem = {
      type: 'https://tasker.dev/problems/validation',
      title: 'Validation failed',
      status: 422,
      detail: 'email is required',
      errors: { email: ['required'] },
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(problem), {
        status: 422,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    );

    await expect(browserRequest('/auth/register', { method: 'POST', body: {} })).rejects.toSatisfy(
      (err: unknown) => {
        if (!(err instanceof HttpError)) return false;
        expect(err.type).toBe(problem.type);
        expect(err.status).toBe(422);
        expect(err.errors?.email).toEqual(['required']);
        return true;
      },
    );
  });

  it('omits traceparent before OTel-web is initialized so the backend mints a root span', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await browserHttp.get('/me');

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['traceparent']).toBeUndefined();
  });

  it('injects a well-formed W3C traceparent header once OTel-web is initialized', async () => {
    initOtelWeb();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await browserHttp.get('/me');

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const headers = (init as RequestInit).headers as Record<string, string>;
    // W3C Trace Context §3.2 — `version-traceId(32 hex)-spanId(16 hex)-flags(2 hex)`.
    expect(headers['traceparent']).toMatch(/^\d{2}-[0-9a-f]{32}-[0-9a-f]{16}-\d{2}$/);
  });

  it('falls back to generic HttpError for non-json failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('boom', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    await expect(browserHttp.get('/broken')).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof HttpError)) return false;
      expect(err.status).toBe(500);
      expect(err.type).toBe('about:blank');
      return true;
    });
  });
});
