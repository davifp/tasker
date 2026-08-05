import { hostname } from 'node:os';
import * as Sentry from '@sentry/node';

export interface SentryInitConfig {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  service: string;
}

// A subset of HTTP status codes we never want to forward to Sentry. These are
// legitimate client-side failures (validation, permission, throttling) whose
// volume would exhaust the free tier without informing operators.
const DROPPED_STATUS_CODES = new Set([400, 401, 403, 404, 405, 409, 410, 422, 429]);

// Fingerprint rate-limit: prevents a runaway loop from a single exception path
// from burning the free-tier budget. Bucketed per fingerprint (event.exception
// stack top). The counters are process-local — good enough for a single node
// deployment; if we ever scale out, upgrade to Redis-backed counters.
const RATE_LIMIT_PER_HOUR = 100;
const rateLimitCounters = new Map<string, { count: number; windowStart: number }>();
const HOUR_MS = 60 * 60 * 1000;

function shouldRateLimit(fingerprint: string): boolean {
  const now = Date.now();
  const entry = rateLimitCounters.get(fingerprint);
  if (!entry || now - entry.windowStart >= HOUR_MS) {
    rateLimitCounters.set(fingerprint, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_PER_HOUR;
}

function extractFingerprint(event: Sentry.ErrorEvent): string {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  // Prefer the innermost in-app frame so anonymised framework entry-points
  // (top of stack) don't collapse distinct application bugs into a single
  // fingerprint. Fall back to top frame, then exception type.
  const inApp = [...frames].reverse().find((f) => f.in_app === true) ?? frames.at(-1);
  if (inApp?.filename && inApp.function) return `${inApp.filename}:${inApp.function}`;
  return event.exception?.values?.[0]?.type ?? 'unknown';
}

let started = false;

// Idempotent — starting twice is a no-op. Callable from telemetry.bootstrap
// (before Nest boot) so the SDK is armed for exceptions during module load.
export function startSentry(config: SentryInitConfig): void {
  if (started || !config.dsn) return;
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    dist: config.service, // 'api' vs 'worker' vs 'web' — Sentry groups source maps by dist.
    tracesSampleRate: config.tracesSampleRate,
    serverName: hostname(),
    // Skip default HTTP integration since @opentelemetry/instrumentation-http
    // already creates request spans; leaving both on double-instruments and
    // inflates transaction counts.
    integrations: (defaults) => defaults.filter((i) => i.name !== 'Http'),
    beforeSend(event) {
      // Drop expected 4xx before they hit the network — the ProblemDetailsFilter
      // still forwards them to Sentry breadcrumb history, but full events are
      // reserved for 5xx / uncaught exceptions.
      const status = event.contexts?.response?.status_code;
      if (typeof status === 'number' && DROPPED_STATUS_CODES.has(status)) return null;
      if (shouldRateLimit(extractFingerprint(event))) return null;
      return event;
    },
  });
  started = true;
}

// Test hook — resets both the started flag and the rate-limit map so specs
// can re-init in isolation.
export function __resetSentryForTests(): void {
  started = false;
  rateLimitCounters.clear();
}
