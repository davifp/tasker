import * as Sentry from '@sentry/nextjs';

// Server-side (Node.js runtime) init. Runs on every RSC render, Route
// Handler invocation, and Server Action. Guarded by DSN presence so dev
// builds without a Sentry project stay silent.
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
