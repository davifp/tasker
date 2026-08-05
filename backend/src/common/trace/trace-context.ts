import { ClsServiceManager } from 'nestjs-cls';
import { CLS_TRACE_ID } from '../cls/cls-keys';

/**
 * Compatibility shim over the CLS singleton. Existing call sites
 * (`audit.service`, `ai-invocation.recorder`, `problem-details.filter`) keep
 * working while the underlying store is unified with the enrichment path used
 * by the pino mixin and — from Task 2.0 — the OpenTelemetry propagator.
 *
 * @deprecated Prefer injecting `ClsService` from `nestjs-cls` in new code.
 * This shim exists to avoid a big-bang migration of every call site.
 */
export const TraceContext = {
  run<T>(traceId: string, fn: () => T): T {
    const cls = ClsServiceManager.getClsService();
    if (cls.isActive()) {
      cls.set(CLS_TRACE_ID, traceId);
      return fn();
    }
    return cls.run(() => {
      cls.set(CLS_TRACE_ID, traceId);
      return fn();
    });
  },

  get(): string | undefined {
    const cls = ClsServiceManager.getClsService();
    if (!cls.isActive()) return undefined;
    return cls.get<string | undefined>(CLS_TRACE_ID);
  },
};
