import path from 'path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Content Security Policy — strict `default-src 'self'`. Allowances:
//   - `script-src` includes `'unsafe-inline'` in dev only (Next's HMR runtime
//     emits inline scripts without stable hashes). Production strips it.
//   - `style-src 'unsafe-inline'` — Tailwind + inline SSR styles + Radix set
//     per-component style attributes; a nonce roundtrip would break RSC
//     streaming, and shipping hashes for every style is impractical.
//   - `connect-src` includes the Sentry ingest origin (via the tunnel URL) and
//     the same-origin API proxy. WebSockets use `ws:`/`wss:` on same origin.
//   - `img-src`/`font-src` allow `data:` so shadcn icons and inline SVGs work.
//   - `frame-ancestors 'none'` forbids embedding under any origin.
const isProduction = process.env['NODE_ENV'] === 'production';

// Object-storage origin for presigned PUT uploads (attachments). Browser
// fetches straight at S3/MinIO — that origin must appear in connect-src or
// the CSP blocks the PUT before it reaches the network. Empty in builds
// without storage configured.
function storageOrigin(): string {
  const raw = process.env['STORAGE_ENDPOINT'] ?? process.env['NEXT_PUBLIC_STORAGE_ENDPOINT'];
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' wss: ws:${storageOrigin() ? ` ${storageOrigin()}` : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  ...(isProduction
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../'),
  // ADR markdown lives at `<repo>/docs/adr/` — outside the frontend workspace.
  // The `/docs` route reads them at build time via `generateStaticParams`, so
  // they must ship inside the standalone bundle.
  outputFileTracingIncludes: {
    '/docs': ['../docs/adr/**/*.md'],
    '/docs/[slug]': ['../docs/adr/**/*.md'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
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
