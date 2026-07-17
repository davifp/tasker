import 'server-only';
import { apiUrl } from '@/lib/http/backend';
import type { SessionPayload } from './session';

interface BackendTokens {
  userId: string;
  accessToken: string;
  refreshToken: string;
  accessExp: number;
}

interface RawAuthResponse {
  userId?: string;
  user?: { id: string };
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt?: string | number;
  accessExp?: number;
}

function coerceExp(raw: RawAuthResponse): number {
  if (typeof raw.accessExp === 'number') return raw.accessExp;
  if (typeof raw.accessTokenExpiresAt === 'number') return raw.accessTokenExpiresAt;
  if (typeof raw.accessTokenExpiresAt === 'string') {
    const parsed = Math.floor(Date.parse(raw.accessTokenExpiresAt) / 1000);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Math.floor(Date.now() / 1000) + 15 * 60;
}

function coerceUserId(raw: RawAuthResponse): string | undefined {
  return raw.userId ?? raw.user?.id;
}

export async function backendFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

export async function loginBackend(body: { email: string; password: string }): Promise<
  | {
      ok: true;
      session: SessionPayload;
    }
  | { ok: false; response: Response }
> {
  const response = await backendFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) return { ok: false, response };

  const raw = (await response.json()) as RawAuthResponse;
  return {
    ok: true,
    session: {
      userId: coerceUserId(raw) ?? 'unknown',
      accessToken: raw.accessToken,
      refreshToken: raw.refreshToken,
      accessExp: coerceExp(raw),
    },
  };
}

export async function registerBackend(body: {
  email: string;
  password: string;
  name: string;
}): Promise<{ ok: true; session: SessionPayload } | { ok: false; response: Response }> {
  const response = await backendFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) return { ok: false, response };

  const raw = (await response.json()) as RawAuthResponse;
  return {
    ok: true,
    session: {
      userId: coerceUserId(raw) ?? 'unknown',
      accessToken: raw.accessToken,
      refreshToken: raw.refreshToken,
      accessExp: coerceExp(raw),
    },
  };
}

export async function refreshBackend(refreshToken: string): Promise<BackendTokens | null> {
  const response = await backendFetch('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) return null;
  const raw = (await response.json()) as RawAuthResponse;
  const userId = coerceUserId(raw);
  if (!userId) return null;
  return {
    userId,
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    accessExp: coerceExp(raw),
  };
}

export async function logoutBackend(accessToken: string): Promise<void> {
  await backendFetch('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => undefined);
}
