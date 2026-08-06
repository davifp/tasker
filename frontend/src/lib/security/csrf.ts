import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { ResponseCookies } from 'next/dist/compiled/@edge-runtime/cookies';

// Shared CSRF constants for the Next.js proxy layer. The cookie is issued on
// session establishment (login, register, oauth-complete) and rotated every
// `CSRF_COOKIE_MAX_AGE_MS`; the proxy validates the `X-CSRF-Token` header on
// every mutating verb against the cookie value. See
// tasks/prd-observability-and-production/techspec.md §Key decisions.
export const CSRF_COOKIE_NAME = 'tsk_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_COOKIE_MAX_AGE_S = 2 * 60 * 60;
const CSRF_TOKEN_BYTES = 32;
const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function mintCsrfToken(now: number = Date.now()): string {
  return `${now.toString(36)}.${randomBytes(CSRF_TOKEN_BYTES).toString('hex')}`;
}

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

interface CookieSink {
  set: (
    name: string,
    value: string,
    options?: {
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'lax';
      path?: string;
      maxAge?: number;
    },
  ) => void;
}

// Writes the cookie to any Next-shape cookie sink (route-handler `NextResponse
// .cookies`, middleware `NextResponse.cookies`, server-action `cookies()`).
// `httpOnly: false` on purpose — the browser JS reads the value and echoes it
// as `X-CSRF-Token` on the next mutating request.
export function issueCsrfCookie(sink: CookieSink | ResponseCookies): void {
  const token = mintCsrfToken();
  (sink as CookieSink).set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: CSRF_COOKIE_MAX_AGE_S,
  });
}

export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

// Returns true when the request supplies a header that matches the cookie in
// constant time. Callers must have already established that the method is
// unsafe (`isUnsafeMethod`). A missing cookie or missing header returns
// false — the caller is responsible for deciding whether to reject.
export function validateCsrfHeader(request: NextRequest | Request): boolean {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieValue = readCookie(cookieHeader, CSRF_COOKIE_NAME);
  if (!cookieValue) return false;
  const headerValue = request.headers.get(CSRF_HEADER_NAME);
  if (!headerValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(headerValue);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readCookie(header: string, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}
