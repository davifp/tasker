import type { IncomingHttpHeaders } from 'node:http';

// W3C Trace Context: `version-traceId(32 hex)-spanId(16 hex)-flags(2 hex)`.
// We only read the traceId segment; span propagation is OTel's job (Task 2.0).
const TRACEPARENT_RE = /^\d{2}-([0-9a-f]{32})-[0-9a-f]{16}-\d{2}$/i;

// Inbound trace propagation. Prefer W3C `traceparent`; fall back to the legacy
// `x-trace-id` header for clients that predate the OTel rollout. Returns
// undefined when neither header carries a usable id so the caller can mint one.
export function extractInboundTraceId(headers: IncomingHttpHeaders): string | undefined {
  const traceparent = headers['traceparent'];
  if (typeof traceparent === 'string') {
    const match = TRACEPARENT_RE.exec(traceparent);
    if (match?.[1]) return match[1];
  }
  const legacy = headers['x-trace-id'];
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return undefined;
}
