import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from '@tasker/config';
import {
  CSRF_COOKIE_MAX_AGE_MS,
  CSRF_COOKIE_NAME,
  CSRF_TOKEN_LENGTH_BYTES,
} from './csrf.constants';

// Issues (or rotates) the double-submit CSRF cookie. The cookie is NOT
// HttpOnly on purpose — the browser JS reads it and echoes the value as an
// `X-CSRF-Token` header on mutating requests; the server compares the two.
// A cross-site attacker cannot read the cookie (same-origin) and therefore
// cannot forge a matching header, blocking classic CSRF while still allowing
// legitimate same-origin flows.
//
// Rotation cadence is bounded by `CSRF_COOKIE_MAX_AGE_MS` — the middleware
// tracks the issue time inside the token itself (`<issuedAtMs>.<random>`),
// so it can decide whether to re-mint without a server-side session store.
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly secureCookies: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.secureCookies = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const existing = readCookie(req.headers['cookie'], CSRF_COOKIE_NAME);
    if (!existing || isExpired(existing)) {
      const token = mintToken();
      res.cookie(CSRF_COOKIE_NAME, token, {
        maxAge: CSRF_COOKIE_MAX_AGE_MS,
        secure: this.secureCookies,
        // `lax` lets top-level GET navigations carry the cookie so the client
        // can bootstrap; POSTs from third-party pages still get blocked by
        // the header/cookie mismatch even if a stale cookie leaks through.
        sameSite: 'lax',
        // NOT HttpOnly — the client JS has to read this value to echo it back.
        httpOnly: false,
        path: '/',
      });
    }
    next();
  }
}

export function mintToken(now: number = Date.now()): string {
  const random = randomBytes(CSRF_TOKEN_LENGTH_BYTES).toString('hex');
  return `${now.toString(36)}.${random}`;
}

export function isExpired(token: string, now: number = Date.now()): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) return true;
  const issuedAt = Number.parseInt(token.slice(0, dot), 36);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return true;
  return now - issuedAt > CSRF_COOKIE_MAX_AGE_MS;
}

// Minimal cookie reader — avoids a `cookie-parser` dependency. Cookie header
// values are `k=v; k=v` pairs; we only need one value, decoded.
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}
