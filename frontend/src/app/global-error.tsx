'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Top-level error boundary. Fires when the root layout itself throws, so it
// must render its own <html>/<body> — Next.js has already unmounted the
// normal root layout by the time this component runs.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Application error</h1>
          <p style={{ marginBottom: 16 }}>The page failed to load. Reload to try again.</p>
          {error.digest ? (
            <code style={{ fontSize: 12, background: '#eee', padding: '4px 8px', borderRadius: 4 }}>
              {error.digest}
            </code>
          ) : null}
        </div>
      </body>
    </html>
  );
}
