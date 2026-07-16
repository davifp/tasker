import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type Redis from 'ioredis';
import { of, firstValueFrom } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

function makeCtx(headers: Record<string, string> = {}, statusCode = 201): ExecutionContext {
  const res: { statusCode: number; status: (n: number) => void } = {
    statusCode,
    status(n: number) {
      this.statusCode = n;
    },
  };
  const req = {
    headers,
    method: 'POST',
    route: { path: '/workspaces' },
    path: '/workspaces',
    user: { userId: 'user-1' },
  };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeReflector(idempotent: boolean): Reflector {
  return { getAllAndOverride: vi.fn().mockReturnValue(idempotent) } as unknown as Reflector;
}

describe('IdempotencyInterceptor', () => {
  let redis: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    redis = {
      get: vi.fn(),
      set: vi.fn(),
    };
  });

  it('passes through when handler is not marked @Idempotent', async () => {
    const interceptor = new IdempotencyInterceptor(makeReflector(false), redis as unknown as Redis);
    const next: CallHandler = { handle: () => of({ ok: true }) };
    const result = await firstValueFrom(interceptor.intercept(makeCtx(), next));
    expect(result).toEqual({ ok: true });
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('passes through when Idempotency-Key header is absent', async () => {
    const interceptor = new IdempotencyInterceptor(makeReflector(true), redis as unknown as Redis);
    const next: CallHandler = { handle: () => of({ ok: true }) };
    const result = await firstValueFrom(interceptor.intercept(makeCtx(), next));
    expect(result).toEqual({ ok: true });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('claims the slot with SET NX pending, runs the handler, then writes the completed cache', async () => {
    const interceptor = new IdempotencyInterceptor(makeReflector(true), redis as unknown as Redis);
    // SET NX wins: the atomic claim returns OK.
    redis.set.mockResolvedValueOnce('OK');
    // SET on completion — no return needed.
    redis.set.mockResolvedValueOnce('OK');
    const firstNext: CallHandler = { handle: () => of({ id: 'w-1' }) };

    const first = await firstValueFrom(
      interceptor.intercept(makeCtx({ 'idempotency-key': 'k-1' }), firstNext),
    );

    expect(first).toEqual({ id: 'w-1' });
    // First call: SET NX pending for 60s
    expect(redis.set).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('idem:user-1:POST:/workspaces:k-1'),
      '__pending__',
      'EX',
      60,
      'NX',
    );
    // Second call: SET completed payload for 24h
    expect(redis.set).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('idem:user-1:POST:/workspaces:k-1'),
      expect.stringContaining('"body":{"id":"w-1"}'),
      'EX',
      86400,
    );
  });

  it('returns the cached response on replay without invoking the handler', async () => {
    const interceptor = new IdempotencyInterceptor(makeReflector(true), redis as unknown as Redis);
    // SET NX loses because the completed cache already exists.
    redis.set.mockResolvedValueOnce(null);
    redis.get.mockResolvedValueOnce(JSON.stringify({ status: 201, body: { id: 'w-1' } }));
    const notCalledNext: CallHandler = { handle: vi.fn() as unknown as () => never };

    const result = await firstValueFrom(
      interceptor.intercept(makeCtx({ 'idempotency-key': 'k-1' }), notCalledNext),
    );

    expect(result).toEqual({ id: 'w-1' });
    expect(notCalledNext.handle as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('returns 409 when a prior request with the same key is still in-flight', async () => {
    const interceptor = new IdempotencyInterceptor(makeReflector(true), redis as unknown as Redis);
    // SET NX loses; GET reports the pending sentinel — another request is running.
    redis.set.mockResolvedValueOnce(null);
    redis.get.mockResolvedValueOnce('__pending__');
    const notCalledNext: CallHandler = { handle: vi.fn() as unknown as () => never };

    await expect(
      firstValueFrom(interceptor.intercept(makeCtx({ 'idempotency-key': 'k-1' }), notCalledNext)),
    ).rejects.toMatchObject({ status: 409 });
    expect(notCalledNext.handle as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('rejects keys longer than the maximum', async () => {
    const interceptor = new IdempotencyInterceptor(makeReflector(true), redis as unknown as Redis);
    const next: CallHandler = { handle: () => of({}) };
    expect(() =>
      interceptor.intercept(makeCtx({ 'idempotency-key': 'x'.repeat(201) }), next),
    ).toThrow(/Idempotency-Key must be at most/);
  });
});
