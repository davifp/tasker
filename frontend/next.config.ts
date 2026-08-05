import path from 'path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../'),
};

// Sentry wrapper. `withSentryConfig` MUST come last (outermost) because it
// mutates the webpack config to inject the source-map upload plugin and the
// build-time debug-id linker.
//
// When SENTRY_AUTH_TOKEN is absent (local dev, forks, CI without the secret)
// the upload step is silently skipped — the SDK still functions, but Sentry
// can't resolve minified stack traces to source without the maps.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env['SENTRY_ORG'] ?? 'davi-pavone',
  project: process.env['SENTRY_PROJECT_WEB'] ?? 'tasker-web',
  authToken: process.env['SENTRY_AUTH_TOKEN'],
  silent: !process.env['CI'],
  telemetry: false,
  widenClientFileUpload: true,
  disableLogger: true,
  // Tunnel avoids ad-blockers eating client-side events by proxying through
  // /monitoring on our own origin. Cheap and preserves free-tier visibility.
  tunnelRoute: '/monitoring',
});
