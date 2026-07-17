const PUBLIC_ROUTES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/oauth',
];

const PUBLIC_API_ROUTES = ['/api/auth', '/api/session', '/api/analytics'];

const ALWAYS_PUBLIC_PREFIXES = ['/_next', '/favicon', '/icons', '/images', '/fonts'];

export type RouteDecision = { action: 'allow' } | { action: 'redirect'; location: string };

export interface DecideOptions {
  pathname: string;
  search?: string;
  hasSession: boolean;
}

export function isProtectedPath(pathname: string): boolean {
  if (ALWAYS_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }
  if (PUBLIC_API_ROUTES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }
  if (pathname === '/' || pathname === '') {
    return false;
  }
  if (PUBLIC_ROUTES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }
  return true;
}

export function decideRoute({ pathname, search = '', hasSession }: DecideOptions): RouteDecision {
  if (!isProtectedPath(pathname)) return { action: 'allow' };
  if (hasSession) return { action: 'allow' };
  const target = `${pathname}${search}`;
  const redirectTo = encodeURIComponent(target);
  return { action: 'redirect', location: `/login?redirectTo=${redirectTo}` };
}
