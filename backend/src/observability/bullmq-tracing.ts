import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Job } from 'bullmq';
import type { ClsService } from 'nestjs-cls';
import { CLS_TRACE_ID, CLS_USER_ID, CLS_WORKSPACE_ID } from '../common/cls/cls-keys';

// Convention: producer stashes the W3C traceparent (and any baggage) here; the
// processor reads it back to continue the same trace across the queue.
export const OTEL_JOB_KEY = '__otel';

export interface JobTelemetryFields {
  userId?: string;
  workspaceId?: string;
  [OTEL_JOB_KEY]?: Record<string, string>;
}

// Inject the active W3C trace context (and optional tenant/user for CLS
// enrichment on the consumer side) into the outbound job payload. `T extends
// object` (not `Record<string, unknown>`) so callers can pass any interface
// without a widening cast.
export function withJobTelemetry<T extends object>(
  data: T,
  extras: { userId?: string; workspaceId?: string } = {},
): T & JobTelemetryFields {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return {
    ...data,
    ...(extras.userId ? { userId: extras.userId } : {}),
    ...(extras.workspaceId ? { workspaceId: extras.workspaceId } : {}),
    // Only include __otel when the propagator actually wrote a header —
    // avoids polluting job payloads with empty objects during unit tests or
    // when no active span exists.
    ...(Object.keys(carrier).length > 0 ? { [OTEL_JOB_KEY]: carrier } : {}),
  };
}

// Wrap a processor's `process` body: extract the parent context from the job
// payload, start a `process.<queue>` span, seed CLS with traceId/userId/
// workspaceId, and run the caller inside both scopes. Errors are recorded on
// the span so downstream error-rate metrics can key off them.
export async function runInJobContext<T>(
  job: Job,
  cls: ClsService,
  spanName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const data = (job.data ?? {}) as JobTelemetryFields;
  const carrier = data[OTEL_JOB_KEY] ?? {};
  const parent = propagation.extract(context.active(), carrier);
  const tracer = trace.getTracer('tasker.bullmq');
  return context.with(parent, () =>
    tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'bullmq',
          'messaging.destination.name': job.queueName,
          'messaging.message.id': job.id ?? '',
        },
      },
      async (span) => {
        return cls.run(async () => {
          const spanCtx = span.spanContext();
          cls.set(CLS_TRACE_ID, spanCtx.traceId);
          if (data.userId) cls.set(CLS_USER_ID, data.userId);
          if (data.workspaceId) cls.set(CLS_WORKSPACE_ID, data.workspaceId);
          try {
            const result = await fn();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
            throw err;
          } finally {
            span.end();
          }
        });
      },
    ),
  );
}
