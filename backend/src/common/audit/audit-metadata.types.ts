import type { AiAction, AiInvocationStatus } from '@prisma/client';

/**
 * Documented shape of `AuditLog.metadata`.
 *
 * `AuditLog.metadata` is a `Json` column, so callers technically can write any
 * shape they want. In practice we keep a stable contract so downstream
 * consumers (audit viewer, exporters, dashboards) can key off known fields
 * without probing.
 *
 * Two producers write into it today:
 *
 *  - `AuditMutationInterceptor` — writes `{ method, path, params, body }`
 *    (sensitive keys stripped) for every mutation decorated with `@Auditable`.
 *  - Phase 9 (AI actions) `AiInvocationRecorder` — writes `{ ai: {...} }` on
 *    top of the interceptor's payload so an AI mutation carries both the HTTP
 *    envelope and the LLM cost fields in the same row.
 *
 * `ai` is optional: rows written before Phase 9 (or from non-AI events) simply
 * omit it. Nothing here is enforced at the DB layer; the JSON column stays
 * flexible so future producers can extend without a migration.
 */
export interface AuditMetadataShape {
  /** HTTP method of the originating request (interceptor writer). */
  method?: string;
  /** Route path template of the originating request (interceptor writer). */
  path?: string;
  /** Route params (`req.params`). */
  params?: Record<string, string>;
  /** Request body with sensitive keys masked. */
  body?: unknown;
  /** AI-invocation cost fields — populated only by `AiInvocationRecorder`. */
  ai?: AuditAiMetadata;
}

/**
 * Cost/telemetry payload captured for each AI invocation, mirrored into the
 * corresponding `AiInvocation` row so audit and analytics can share the same
 * fields. `cachedInputTokens` is only meaningful for providers that report
 * cache hits (Anthropic prompt caching); the OpenAI adapter reports `0`.
 */
export interface AuditAiMetadata {
  action: AiAction;
  provider: 'anthropic' | 'openai';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  latencyMs: number;
  status: AiInvocationStatus;
  /** Populated only when `status !== 'OK'`. */
  errorCode?: string;
}
