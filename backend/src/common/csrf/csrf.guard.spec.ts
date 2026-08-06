import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './csrf.constants';
import { SKIP_CSRF_KEY } from './skip-csrf.decorator';

function httpContext({
  method,
  cookie,
  header,
  meta = {},
}: {
  method: string;
  cookie?: string;
  header?: string;
  meta?: Record<string, unknown>;
}): { ctx: ExecutionContext; reflector: Reflector } {
  const req = {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(header ? { [CSRF_HEADER_NAME]: header } : {}),
    },
  };
  const ctx = {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: (key: string) => (key === SKIP_CSRF_KEY ? meta[SKIP_CSRF_KEY] : undefined),
  } as unknown as Reflector;
  return { ctx, reflector };
}

describe('CsrfGuard', () => {
  it('passes safe verbs through', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const { ctx, reflector } = httpContext({ method });
      const guard = new CsrfGuard(reflector);
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('passes mutating verbs when no CSRF cookie is present (Bearer/API-key path)', () => {
    const { ctx, reflector } = httpContext({ method: 'POST' });
    expect(new CsrfGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('accepts a mutating verb when header matches cookie', () => {
    const token = 'k1234567890.abcdefabcdefabcdefabcdefabcdefabcd';
    const { ctx, reflector } = httpContext({
      method: 'POST',
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
      header: token,
    });
    expect(new CsrfGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('rejects a mutating verb when header is missing', () => {
    const token = 'k1234567890.abcdefabcdefabcdefabcdefabcdefabcd';
    const { ctx, reflector } = httpContext({
      method: 'POST',
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
    });
    expect(() => new CsrfGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects a mutating verb when header mismatches cookie', () => {
    const cookie = 'k1234567890.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const header = 'k1234567890.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const { ctx, reflector } = httpContext({
      method: 'POST',
      cookie: `${CSRF_COOKIE_NAME}=${cookie}`,
      header,
    });
    expect(() => new CsrfGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('honors @SkipCsrf() when set on the handler or class', () => {
    const cookie = 'k1234567890.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const { ctx, reflector } = httpContext({
      method: 'POST',
      cookie: `${CSRF_COOKIE_NAME}=${cookie}`,
      // header missing — normally a reject
      meta: { [SKIP_CSRF_KEY]: true },
    });
    expect(new CsrfGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('bypasses non-http contexts (WS)', () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const ctx = { getType: () => 'ws' } as unknown as ExecutionContext;
    expect(new CsrfGuard(reflector).canActivate(ctx)).toBe(true);
  });
});
