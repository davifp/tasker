import { describe, it, expect } from 'vitest';
import { decideRoute, isProtectedPath } from './route-protection';

describe('isProtectedPath', () => {
  it.each([
    ['/acme/projects', true],
    ['/acme/settings', true],
    ['/workspaces/new', true],
    ['/api/proxy/me', true],
    ['/api/workspaces/select', true],
  ])('%s → protected=%s', (path, expected) => {
    expect(isProtectedPath(path)).toBe(expected);
  });

  it.each([
    ['/', false],
    ['/login', false],
    ['/signup', false],
    ['/forgot-password', false],
    ['/reset-password/abc', false],
    ['/verify-email', false],
    ['/oauth/google/complete', false],
    ['/api/auth/login', false],
    ['/api/session', false],
    ['/api/analytics/events', false],
    ['/_next/static/x.js', false],
    ['/favicon.ico', false],
  ])('%s → public', (path) => {
    expect(isProtectedPath(path)).toBe(false);
  });
});

describe('decideRoute', () => {
  it('allows an unauthenticated request to a public route', () => {
    expect(decideRoute({ pathname: '/login', hasSession: false })).toEqual({ action: 'allow' });
  });

  it('allows an authenticated request to any route', () => {
    expect(decideRoute({ pathname: '/acme/projects', hasSession: true })).toEqual({
      action: 'allow',
    });
  });

  it('redirects an unauthenticated request to /login with redirectTo=', () => {
    const decision = decideRoute({
      pathname: '/acme/projects',
      search: '?tab=active',
      hasSession: false,
    });
    expect(decision).toEqual({
      action: 'redirect',
      location: '/login?redirectTo=%2Facme%2Fprojects%3Ftab%3Dactive',
    });
  });

  it('preserves deep-link query strings inside the redirectTo parameter', () => {
    const decision = decideRoute({
      pathname: '/acme/settings',
      search: '?section=danger',
      hasSession: false,
    });
    expect(decision.action).toBe('redirect');
    if (decision.action !== 'redirect') return;
    const redirectTo = new URL(`http://x${decision.location}`).searchParams.get('redirectTo');
    expect(redirectTo).toBe('/acme/settings?section=danger');
  });
});
