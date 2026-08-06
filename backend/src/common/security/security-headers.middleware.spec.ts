import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import type { NextFunction, Request, Response } from 'express';
import { SecurityHeadersMiddleware } from './security-headers.middleware';

function makeConfig(nodeEnv: string): ConfigService<Env, true> {
  return { get: () => nodeEnv } as unknown as ConfigService<Env, true>;
}

function makeRes(): { res: Response; setHeader: ReturnType<typeof vi.fn> } {
  const setHeader = vi.fn();
  return { res: { setHeader } as unknown as Response, setHeader };
}

describe('SecurityHeadersMiddleware', () => {
  it('sets baseline headers on every response', () => {
    const middleware = new SecurityHeadersMiddleware(makeConfig('production'));
    const { res, setHeader } = makeRes();
    const next = vi.fn() as unknown as NextFunction;
    middleware.use({} as Request, res, next);
    const keys = setHeader.mock.calls.map((c) => c[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'X-Content-Type-Options',
        'Referrer-Policy',
        'Permissions-Policy',
        'X-Frame-Options',
        'Strict-Transport-Security',
      ]),
    );
    expect(next).toHaveBeenCalled();
  });

  it('omits HSTS outside production so local http:// dev is not stuck upgraded', () => {
    const middleware = new SecurityHeadersMiddleware(makeConfig('development'));
    const { res, setHeader } = makeRes();
    middleware.use({} as Request, res, vi.fn() as unknown as NextFunction);
    const keys = setHeader.mock.calls.map((c) => c[0]);
    expect(keys).not.toContain('Strict-Transport-Security');
  });
});
