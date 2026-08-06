import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import type { NextFunction, Request, Response } from 'express';
import { CsrfMiddleware, isExpired, mintToken, readCookie } from './csrf.middleware';
import { CSRF_COOKIE_MAX_AGE_MS, CSRF_COOKIE_NAME } from './csrf.constants';

function makeConfig(nodeEnv = 'production'): ConfigService<Env, true> {
  return { get: () => nodeEnv } as unknown as ConfigService<Env, true>;
}

function makeReqRes(cookie?: string): { req: Request; res: Response; next: NextFunction } {
  const req = { headers: cookie ? { cookie } : {} } as unknown as Request;
  const res = { cookie: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('CsrfMiddleware', () => {
  it('sets a CSRF cookie when none is present', () => {
    const middleware = new CsrfMiddleware(makeConfig());
    const { req, res, next } = makeReqRes();
    middleware.use(req, res, next);
    expect(res.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      expect.stringMatching(/^[0-9a-z]+\.[0-9a-f]{64}$/),
      expect.objectContaining({ httpOnly: false, sameSite: 'lax', path: '/', secure: true }),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not rotate a fresh cookie', () => {
    const middleware = new CsrfMiddleware(makeConfig('development'));
    const fresh = mintToken();
    const { req, res, next } = makeReqRes(`${CSRF_COOKIE_NAME}=${fresh}`);
    middleware.use(req, res, next);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rotates an expired cookie', () => {
    const middleware = new CsrfMiddleware(makeConfig());
    const stale = mintToken(Date.now() - CSRF_COOKIE_MAX_AGE_MS - 1000);
    const { req, res, next } = makeReqRes(`${CSRF_COOKIE_NAME}=${stale}`);
    middleware.use(req, res, next);
    expect(res.cookie).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('sets secure=false outside production', () => {
    const middleware = new CsrfMiddleware(makeConfig('development'));
    const { req, res, next } = makeReqRes();
    middleware.use(req, res, next);
    const call = (res.cookie as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[2]?.secure).toBe(false);
  });
});

describe('isExpired', () => {
  it('flags tokens issued past the max-age window', () => {
    const token = mintToken(Date.now() - CSRF_COOKIE_MAX_AGE_MS - 1);
    expect(isExpired(token)).toBe(true);
  });

  it('accepts fresh tokens', () => {
    const token = mintToken();
    expect(isExpired(token)).toBe(false);
  });

  it('flags malformed tokens', () => {
    expect(isExpired('not-a-token')).toBe(true);
    expect(isExpired('')).toBe(true);
    expect(isExpired('abc.random')).toBe(true);
  });
});

describe('readCookie', () => {
  it('reads a URL-encoded value', () => {
    expect(readCookie('tsk_csrf=abc%20def', 'tsk_csrf')).toBe('abc def');
  });

  it('returns undefined when the cookie is missing', () => {
    expect(readCookie('other=1', 'tsk_csrf')).toBeUndefined();
    expect(readCookie(undefined, 'tsk_csrf')).toBeUndefined();
  });
});
