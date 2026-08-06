import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SAFE_METHODS } from './csrf.constants';
import { readCookie } from './csrf.middleware';
import { SKIP_CSRF_KEY } from './skip-csrf.decorator';

// Double-submit CSRF gate. Only runs when the request:
//   1. is HTTP (not WS),
//   2. uses a mutating verb, and
//   3. arrives with the CSRF cookie (i.e. cookie-authenticated).
//
// Bearer- and API-key-authenticated calls do not carry the cookie and are
// therefore fast-pathed; the `@SkipCsrf()` decorator is an explicit escape
// hatch for controllers that opt out (webhook receivers, integration OAuth
// callbacks). See techspec § Key decisions — Double-submit CSRF cookie.
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const method = (req.method ?? '').toUpperCase();
    if (SAFE_METHODS.has(method)) return true;

    const cookie = readCookie(req.headers['cookie'], CSRF_COOKIE_NAME);
    // No cookie -> not cookie-authenticated -> nothing to double-submit
    // against. Bearer/API-key auth path.
    if (!cookie) return true;

    const header = req.headers[CSRF_HEADER_NAME];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !constantTimeEqualsBuffered(cookie, provided)) {
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/csrf',
        title: 'CSRF token missing or invalid',
        status: 403,
      });
    }
    return true;
  }
}

function constantTimeEqualsBuffered(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
