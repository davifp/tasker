'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Route-level error boundary. Fires for uncaught errors inside a route
// segment (client or RSC). The `digest` on `error` is Sentry's opaque id we
// echo back in the UI so support requests carry an identifier.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        We've been notified and are looking into it. If this keeps happening, quote reference:
      </p>
      {error.digest ? (
        <code className="rounded bg-muted px-2 py-1 text-xs">{error.digest}</code>
      ) : null}
      <button
        type="button"
        className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  );
}
