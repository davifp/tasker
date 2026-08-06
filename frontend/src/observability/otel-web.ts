'use client';

import { context, trace, type Tracer } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { StackContextManager, WebTracerProvider } from '@opentelemetry/sdk-trace-web';

// Deliberately minimal: no exporter is registered — spans are only ever
// consumed for their trace/span IDs, which we inject into `traceparent` on
// outbound fetches so the backend and the browser share a trace. Sending
// spans to Tempo/OTel-Collector from the browser is a follow-up (needs CORS
// on the collector + a bundle-size review; techspec §Known risks).
//
// We also avoid `@opentelemetry/instrumentation-fetch` on purpose: it would
// wrap `window.fetch` globally, which conflicts with Next.js's own patched
// fetch used for RSC caching. The explicit injection in `browserRequest`
// covers every request we care about (they all go through the API proxy).
//
// `StackContextManager` (bundled with `sdk-trace-web`) is enough for the
// synchronous `context.with(...)` pattern used by `withClientSpan`; using
// `ZoneContextManager` would pull in `zone.js` as a peer for no functional
// benefit.

let initialized = false;
const propagator = new W3CTraceContextPropagator();
const TRACER_NAME = 'tasker-web';

export function initOtelWeb(): void {
  if (initialized || typeof window === 'undefined') return;
  const provider = new WebTracerProvider();
  provider.register({ contextManager: new StackContextManager() });
  initialized = true;
}

/**
 * Test-only reset. Vitest workers share module state; without this helper an
 * `initOtelWeb()` call in one suite would poison another suite's assertions
 * about pre-init behavior.
 */
export function __resetOtelWebForTests(): void {
  initialized = false;
}

export function getWebTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Injects the active OTel span's `traceparent` (and `tracestate` if present)
 * into the given headers bag. Called by `browserRequest` for every outbound
 * request so backend spans stitch under the same trace as the browser
 * interaction that triggered them.
 *
 * If OTel-web is not initialized (SSR path, or before hydration completed)
 * the function is a no-op — the backend will mint its own root span.
 */
export function injectTraceparentHeaders(headers: Record<string, string>): void {
  if (!initialized) return;
  propagator.inject(context.active(), headers, {
    set: (carrier, key, value) => {
      (carrier as Record<string, string>)[key] = String(value);
    },
  });
}

/**
 * Runs the given callback inside a fresh CLIENT-kind span. The span exists
 * purely so `injectTraceparentHeaders` has an active context to serialize.
 * The span is ended synchronously after the callback returns — this is not
 * an APM-quality timing measurement, it's a correlation seed.
 */
export function withClientSpan<T>(name: string, fn: () => T): T {
  if (!initialized) return fn();
  const tracer = getWebTracer();
  const span = tracer.startSpan(name);
  try {
    return context.with(trace.setSpan(context.active(), span), fn);
  } finally {
    span.end();
  }
}
