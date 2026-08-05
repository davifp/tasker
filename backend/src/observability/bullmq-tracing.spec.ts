import { describe, it, expect, beforeEach } from 'vitest';
import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ClsServiceManager } from 'nestjs-cls';
import type { Job } from 'bullmq';
import { CLS_TRACE_ID, CLS_USER_ID, CLS_WORKSPACE_ID } from '../common/cls/cls-keys';
import { OTEL_JOB_KEY, runInJobContext, withJobTelemetry } from './bullmq-tracing';

// Provider + exporter for span assertions. Created once and left resident for
// the entire suite (no need to restart between tests — spans are captured on
// the exporter and reset in beforeEach).
const contextManager = new AsyncHooksContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
trace.setGlobalTracerProvider(provider);
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

function makeJob(data: Record<string, unknown>, name = 'test-job', queueName = 'test-queue'): Job {
  return { data, name, id: 'job-1', queueName } as unknown as Job;
}

describe('withJobTelemetry', () => {
  beforeEach(() => exporter.reset());

  it('adds an __otel field with the W3C traceparent for the active span', () => {
    const tracer = trace.getTracer('test');
    tracer.startActiveSpan('parent', (span) => {
      const enriched = withJobTelemetry({ foo: 'bar' });
      expect(enriched[OTEL_JOB_KEY]).toBeDefined();
      const carrier = enriched[OTEL_JOB_KEY]!;
      expect(carrier['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      // traceparent's traceId segment must match the active span's traceId
      expect(carrier['traceparent']).toContain(span.spanContext().traceId);
      expect(enriched.foo).toBe('bar');
      span.end();
    });
  });

  it('preserves the input fields untouched and adds extras when supplied', () => {
    const tracer = trace.getTracer('test');
    tracer.startActiveSpan('parent', (span) => {
      const enriched = withJobTelemetry(
        { payload: { x: 1 } },
        { userId: 'u-1', workspaceId: 'w-1' },
      );
      expect(enriched.payload).toEqual({ x: 1 });
      expect(enriched.userId).toBe('u-1');
      expect(enriched.workspaceId).toBe('w-1');
      span.end();
    });
  });

  it('omits userId/workspaceId when not provided', () => {
    const enriched = withJobTelemetry({});
    expect(enriched).not.toHaveProperty('userId');
    expect(enriched).not.toHaveProperty('workspaceId');
  });

  it('omits __otel entirely when no active span produces a carrier (avoids empty object noise)', () => {
    const enriched = withJobTelemetry({});
    expect(enriched).not.toHaveProperty(OTEL_JOB_KEY);
  });
});

describe('runInJobContext', () => {
  beforeEach(() => exporter.reset());

  it('starts a CONSUMER span linked to the parent traceparent from the job payload', async () => {
    const cls = ClsServiceManager.getClsService();

    // Producer side: create a parent span and inject into a carrier.
    const tracer = trace.getTracer('test');
    const rootSpan = tracer.startSpan('producer');
    const parentCtx = trace.setSpan(context.active(), rootSpan);
    const carrier: Record<string, string> = {};
    propagation.inject(parentCtx, carrier);
    rootSpan.end();

    // Consumer side: run inside runInJobContext.
    const job = makeJob({ [OTEL_JOB_KEY]: carrier, userId: 'u-9', workspaceId: 'w-9' });
    let capturedCls: Record<string, string | undefined> = {};
    const result = await runInJobContext(job, cls, 'process.q.x', async () => {
      capturedCls = {
        traceId: cls.get(CLS_TRACE_ID),
        userId: cls.get(CLS_USER_ID),
        workspaceId: cls.get(CLS_WORKSPACE_ID),
      };
      return 42;
    });
    expect(result).toBe(42);

    // Wait a tick for the SimpleSpanProcessor to flush.
    const spans = exporter.getFinishedSpans();
    const consumer = spans.find((s) => s.name === 'process.q.x');
    expect(consumer).toBeDefined();
    expect(consumer!.parentSpanContext?.traceId).toBe(rootSpan.spanContext().traceId);
    expect(consumer!.attributes['messaging.system']).toBe('bullmq');
    expect(consumer!.attributes['messaging.destination.name']).toBe('test-queue');

    // CLS was populated from job payload + active span
    expect(capturedCls.traceId).toBe(rootSpan.spanContext().traceId);
    expect(capturedCls.userId).toBe('u-9');
    expect(capturedCls.workspaceId).toBe('w-9');
  });

  it('records the exception and marks the span as ERROR when the callback throws', async () => {
    const cls = ClsServiceManager.getClsService();
    const job = makeJob({});
    await expect(
      runInJobContext(job, cls, 'process.q.err', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const spans = exporter.getFinishedSpans();
    const errSpan = spans.find((s) => s.name === 'process.q.err');
    expect(errSpan).toBeDefined();
    expect(errSpan!.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(errSpan!.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('runs the callback even when the job payload has no __otel field', async () => {
    const cls = ClsServiceManager.getClsService();
    const job = makeJob({});
    const result = await runInJobContext(job, cls, 'process.q.no-parent', async () => 'ok');
    expect(result).toBe('ok');
  });
});
