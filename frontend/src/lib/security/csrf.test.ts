import { describe, expect, it } from 'vitest';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  isUnsafeMethod,
  mintCsrfToken,
  readCookie,
  validateCsrfHeader,
} from './csrf';

function req(cookieHeader: string | undefined, headerValue?: string): Request {
  const headers = new Headers();
  if (cookieHeader) headers.set('cookie', cookieHeader);
  if (headerValue) headers.set(CSRF_HEADER_NAME, headerValue);
  return new Request('https://example.com/api/proxy/tasks', {
    method: 'POST',
    headers,
  });
}

describe('csrf helpers', () => {
  it('mints a well-formed token with an encoded issue timestamp prefix', () => {
    const t = mintCsrfToken();
    expect(t).toMatch(/^[0-9a-z]+\.[0-9a-f]{64}$/);
  });

  it('classifies unsafe methods correctly', () => {
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(isUnsafeMethod(m)).toBe(true);
      expect(isUnsafeMethod(m.toLowerCase())).toBe(true);
    }
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(isUnsafeMethod(m)).toBe(false);
  });

  it('reads a URL-encoded cookie value', () => {
    expect(readCookie('a=1; tsk_csrf=abc%20def; b=2', 'tsk_csrf')).toBe('abc def');
  });

  it('rejects when cookie or header is missing', () => {
    const token = mintCsrfToken();
    expect(validateCsrfHeader(req(undefined, token))).toBe(false);
    expect(validateCsrfHeader(req(`${CSRF_COOKIE_NAME}=${token}`))).toBe(false);
  });

  it('accepts when header matches cookie exactly', () => {
    const token = mintCsrfToken();
    expect(validateCsrfHeader(req(`${CSRF_COOKIE_NAME}=${token}`, token))).toBe(true);
  });

  it('rejects when header and cookie differ', () => {
    expect(validateCsrfHeader(req(`${CSRF_COOKIE_NAME}=${mintCsrfToken()}`, mintCsrfToken()))).toBe(
      false,
    );
  });
});
