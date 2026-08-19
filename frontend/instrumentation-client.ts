import * as Sentry from '@sentry/nextjs';

// Client-side (browser) init. Loaded by Next.js from the project root at
// startup. The DSN is public and embedded in the client bundle — the whole
// point is that browsers post events directly to Sentry.
const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'] ?? '';
if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env['NEXT_PUBLIC_SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development',
    release: process.env['NEXT_PUBLIC_RELEASE_ID'] || undefined,
    dist: 'web',
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1,
    // Session Replay is heavy and eats free-tier budget fast; keep it off by
    // default and flip it on if we need to diagnose a specific incident.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Beacon transport keeps events flowing even on hard navigations.
    transportOptions: { fetchOptions: { keepalive: true } },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
