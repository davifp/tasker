import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { TraceIdMiddleware } from './trace-id.middleware';
import { TraceContext } from '../trace/trace-context';

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as Response & { headers: Record<string, string> };
}

describe('TraceIdMiddleware', () => {
  const middleware = new TraceIdMiddleware();

  it('reuses an inbound x-trace-id header', () => {
    const req = makeReq({ 'x-trace-id': 'inbound-id' });
    const res = makeRes();
    let captured: string | undefined;
    const next = vi.fn(() => {
      captured = TraceContext.get();
    });

    middleware.use(req, res, next);

    expect(res.headers['x-trace-id']).toBe('inbound-id');
    expect(captured).toBe('inbound-id');
    expect(next).toHaveBeenCalledOnce();
  });

  it('generates a UUID when x-trace-id is absent', () => {
    const req = makeReq();
    const res = makeRes();
    let captured: string | undefined;
    const next = vi.fn(() => {
      captured = TraceContext.get();
    });

    middleware.use(req, res, next);

    expect(res.headers['x-trace-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(captured).toBe(res.headers['x-trace-id']);
    expect(next).toHaveBeenCalledOnce();
  });

  it('stores the traceId in AsyncLocalStorage', () => {
    const req = makeReq({ 'x-trace-id': 'als-test' });
    const res = makeRes();
    let insideAls: string | undefined;
    const next = vi.fn(() => {
      insideAls = TraceContext.get();
    });

    middleware.use(req, res, next);

    expect(insideAls).toBe('als-test');
  });
});
