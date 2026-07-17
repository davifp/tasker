import { cookies } from 'next/headers';
import { getIronSession, sealData, unsealData } from 'iron-session';
import { SESSION_COOKIE_NAME, getSessionOptions, REFRESH_LEEWAY_SECONDS } from './config';

export interface SessionPayload {
  userId: string;
  accessToken: string;
  refreshToken: string;
  accessExp: number;
}

type IronSession = SessionPayload & {
  save: () => Promise<void>;
  destroy: () => Promise<void>;
};

async function readIronSession(): Promise<IronSession> {
  const cookieStore = await cookies();
  return getIronSession<SessionPayload>(
    cookieStore,
    getSessionOptions(),
  ) as unknown as Promise<IronSession>;
}

function hasCredentials(session: SessionPayload | IronSession): boolean {
  return Boolean(
    session.userId && session.accessToken && session.refreshToken && session.accessExp,
  );
}

export async function getSession(): Promise<SessionPayload | null> {
  const session = await readIronSession();
  return hasCredentials(session)
    ? {
        userId: session.userId,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        accessExp: session.accessExp,
      }
    : null;
}

export async function setSession(payload: SessionPayload): Promise<void> {
  const session = await readIronSession();
  session.userId = payload.userId;
  session.accessToken = payload.accessToken;
  session.refreshToken = payload.refreshToken;
  session.accessExp = payload.accessExp;
  await session.save();
}

export async function clearSession(): Promise<void> {
  const session = await readIronSession();
  await session.destroy();
}

export function isExpiring(
  payload: SessionPayload,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  return payload.accessExp - now <= REFRESH_LEEWAY_SECONDS;
}

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  accessExp: number;
}

export async function refreshIfNeeded(
  refresher: (refreshToken: string) => Promise<RefreshedTokens | null>,
): Promise<SessionPayload | null> {
  const current = await getSession();
  if (!current) return null;
  if (!isExpiring(current)) return current;

  const refreshed = await refresher(current.refreshToken);
  if (!refreshed) {
    await clearSession();
    return null;
  }

  const next: SessionPayload = {
    userId: current.userId,
    ...refreshed,
  };
  await setSession(next);
  return next;
}

export async function encodeSession(payload: SessionPayload): Promise<string> {
  return sealData(payload, { password: getSessionOptions().password as string });
}

export async function decodeSession(sealed: string): Promise<SessionPayload | null> {
  try {
    const decoded = await unsealData<SessionPayload>(sealed, {
      password: getSessionOptions().password as string,
    });
    if (!decoded || !decoded.userId) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get('cookie');
  if (!cookie) return false;
  return cookie.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
}
