import * as Sentry from '@sentry/nextjs';

// Next.js instrumentation hook. Fires once per runtime start; we branch on
// NEXT_RUNTIME to load the right Sentry init file. `onRequestError` catches
// errors thrown from Server Components, middleware, and route handlers that
// would otherwise never reach a client-side error boundary.
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env['NEXT_RUNTIME'] === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
