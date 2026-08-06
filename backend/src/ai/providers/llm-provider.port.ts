import type { ZodType } from 'zod';

/**
 * Provider-agnostic contract for an LLM back-end. Adapters (Anthropic,
 * OpenAI) implement this port; every use-case service depends on the port
 * (via `LlmRouter`), never on a concrete adapter. Keeping the seam narrow
 * makes it a two-file change to swap or add a provider.
 *
 * Two shapes are exposed:
 *
 *  - `complete<T>()` — structured output. The adapter enforces the caller's
 *    Zod schema at the provider boundary (Anthropic `tool_use.input_schema`
 *    or OpenAI `response_format.json_schema`) and returns the parsed value
 *    plus usage counters for reconciliation with `AiBudgetService`.
 *  - `stream()` — token deltas as an async iterable, so callers can pipe to
 *    Server-Sent Events without buffering the full response.
 *
 * Adapters must never throw provider-specific error classes. Wrap them in
 * `LlmProviderError` so `LlmRouter.retry-once-fallback` can key off shape,
 * not the underlying SDK.
 */
export interface LlmProvider {
  readonly name: LlmProviderName;

  complete<T>(req: LlmStructuredRequest<T>): Promise<LlmStructuredResult<T>>;
  stream(req: LlmStreamRequest): AsyncIterable<LlmChunk>;
  /**
   * Lightweight liveness probe. Adapters MUST use a cheap, quota-free
   * endpoint (Anthropic `/v1/models`, OpenAI `/v1/models`) and MUST respect
   * `timeoutMs` via an `AbortSignal`. Throws on any failure — used by
   * `LlmHealthIndicator` to short-circuit /readiness.
   */
  ping(timeoutMs: number): Promise<void>;
}

export type LlmProviderName = 'anthropic' | 'openai';

/**
 * Marks how a prompt block should participate in the provider's prompt
 * cache. Anthropic honors both `1h` and `5m`; OpenAI ignores the marker
 * (its cache is content-hash driven under the hood).
 *
 * Only `system`-role blocks should ever carry a cache marker — putting the
 * marker on a user-role block means the untrusted content itself is being
 * cached, which breaks tenant isolation. `PromptBuilder` unit tests assert
 * this invariant.
 */
export interface PromptBlock {
  text: string;
  cache?: { ttl: '5m' | '1h' };
}

interface LlmRequestBase {
  workspaceId: string;
  /** Stable per-workspace identifier used by adapters to key their cache. */
  cacheKey: string;
  /**
   * System/instruction blocks. Ordering is preserved: the workspace preface
   * (long-lived cache) belongs first, the action instruction (short-lived
   * cache) next, any volatile system content last.
   */
  systemBlocks: PromptBlock[];
  /**
   * Untrusted user/task/comment content. `PromptBuilder` wraps this with
   * spotlight delimiters so the model treats instructions inside as data.
   */
  userMessage: string;
  /** Absolute cap on output tokens — used for pre-flight budget reservation. */
  maxTokens: number;
  /** Overrides the adapter's per-action default when set. */
  model?: string;
  /** Optional abort signal — adapters MUST forward this to the SDK. */
  signal?: AbortSignal;
}

export interface LlmStructuredRequest<T> extends LlmRequestBase {
  /** Zod schema mapped to `tool_use.input_schema` / `response_format.json_schema`. */
  schema: ZodType<T>;
  /** Tool/schema name — must be a stable identifier per use-case. */
  schemaName: string;
  /** One-line description surfaced to the model as the tool description. */
  schemaDescription: string;
}

export type LlmStreamRequest = LlmRequestBase;

export interface LlmStructuredResult<T> {
  value: T;
  usage: LlmUsage;
  model: string;
}

export interface LlmChunk {
  /** Incremental text delta since the last chunk (may be empty on control frames). */
  delta: string;
  /** Present on the terminal chunk only. */
  usage?: LlmUsage;
  /** Present on the terminal chunk only — final model id reported by the provider. */
  model?: string;
  done: boolean;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache hit tokens (Anthropic). OpenAI reports 0. */
  cachedInputTokens: number;
}

/**
 * Injection token for the resolved default `LlmProvider`. `LlmRouter`
 * consumes providers via their concrete classes rather than this token —
 * the token exists so tests can rebind the provider that use-cases would
 * normally get via the router.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/**
 * Error thrown by adapters. `reason` drives router behavior:
 *
 *  - `overloaded` / `rate_limited` / `network` → single fallback attempt.
 *  - `validation` / `refusal` → surfaced immediately; no fallback (a
 *    semantic disagreement between the caller and the provider will not
 *    resolve by retrying against a different provider).
 *  - `aborted` → surface immediately; the request was cancelled.
 *  - `unknown` → single fallback attempt (belt-and-braces; adapters SHOULD
 *    classify explicitly).
 */
export class LlmProviderError extends Error {
  constructor(
    public readonly reason:
      'overloaded' | 'rate_limited' | 'network' | 'validation' | 'refusal' | 'aborted' | 'unknown',
    public readonly provider: LlmProviderName,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }

  isRetryable(): boolean {
    return (
      this.reason === 'overloaded' ||
      this.reason === 'rate_limited' ||
      this.reason === 'network' ||
      this.reason === 'unknown'
    );
  }
}
