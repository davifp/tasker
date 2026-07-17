import type { SessionOptions } from 'iron-session';

export const SESSION_COOKIE_NAME = 'tsk_session';
export const WORKSPACE_COOKIE_NAME = 'tsk_workspace';

const DEV_FALLBACK_SECRET = 'development-only-secret-please-change-me-0000';

function resolveSecret(): string {
  const raw = process.env['SESSION_COOKIE_SECRET'];
  if (raw && raw.length >= 32) return raw;
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'SESSION_COOKIE_SECRET must be set to a random string of at least 32 characters in production.',
    );
  }
  return DEV_FALLBACK_SECRET;
}

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

export function getSessionOptions(): SessionOptions {
  return {
    password: resolveSecret(),
    cookieName: SESSION_COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      secure: isProduction(),
      sameSite: 'lax',
      path: '/',
    },
  };
}

export function getWorkspaceCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: '/',
  };
}

export const REFRESH_LEEWAY_SECONDS = 60;
