import * as Sentry from '@sentry/nextjs';

// Edge runtime init. Runs in middleware and any route/layout exported with
// `export const runtime = 'edge'`. The edge runtime has a subset of Node
// globals, so the SDK loads a slimmer integration set.
const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'] ?? '';
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'development',
    release: process.env['NEXT_PUBLIC_RELEASE_ID'] || process.env['RELEASE_ID'] || undefined,
    dist: 'web',
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1,
    debug: false,
  });
}
