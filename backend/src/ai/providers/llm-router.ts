import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import { AnthropicLlmProvider } from './anthropic.provider';
import { OpenAiLlmProvider } from './openai.provider';
import {
  LlmChunk,
  LlmProvider,
  LlmProviderError,
  LlmProviderName,
  LlmStreamRequest,
  LlmStructuredRequest,
  LlmStructuredResult,
} from './llm-provider.port';

interface RouterCallOutcome<T> {
  provider: LlmProviderName;
  fallbackReason?: LlmProviderError['reason'];
  value: T;
}

/**
 * Routes AI calls to the configured default provider and, on transient
 * failure, retries **exactly once** against the configured fallback. Semantic
 * failures (validation, refusal, aborted) short-circuit — retrying against a
 * different provider will not resolve them and would double-bill the caller.
 *
 * Callers are use-case services; they see the router as an `LlmProvider`
 * shape via `complete()` / `stream()`, and get fallback metadata through the
 * `callWithFallback` variants used by `AiInvocationRecorder` (Task 4.0).
 */
@Injectable()
export class LlmRouter {
  private readonly logger = new Logger(LlmRouter.name);
  private readonly defaultName: LlmProviderName;
  private readonly fallbackName?: LlmProviderName;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly anthropic: AnthropicLlmProvider,
    private readonly openai: OpenAiLlmProvider,
  ) {
    this.defaultName = this.config.get('AI_DEFAULT_PROVIDER', { infer: true });
    this.fallbackName = this.config.get('AI_FALLBACK_PROVIDER', { infer: true });
    if (this.fallbackName === this.defaultName) {
      throw new Error(
        `AI_FALLBACK_PROVIDER (${this.fallbackName}) must differ from AI_DEFAULT_PROVIDER (${this.defaultName})`,
      );
    }
  }

  /** Non-streaming path with automatic single-shot fallback. */
  async complete<T>(
    req: LlmStructuredRequest<T>,
  ): Promise<RouterCallOutcome<LlmStructuredResult<T>>> {
    const primary = this.pick(this.defaultName);
    try {
      const value = await primary.complete(req);
      return { provider: primary.name, value };
    } catch (err) {
      const providerErr = this.toProviderError(err, primary.name);
      if (!this.shouldFallback(providerErr)) throw providerErr;
      const fb = this.pickFallback();
      if (!fb) throw providerErr;
      this.logger.warn(
        { from: primary.name, to: fb.name, reason: providerErr.reason },
        'Falling back to secondary LLM provider',
      );
      const value = await fb.complete(req);
      return { provider: fb.name, fallbackReason: providerErr.reason, value };
    }
  }

  /**
   * Streaming path. The fallback attempt is only exercised when the primary
   * fails **before** yielding any chunk — once bytes are on the wire, we do
   * not restart the stream against a different provider (the caller has
   * already seen a partial response). Callers that want strict all-or-
   * nothing semantics should use `complete()`.
   */
  async *stream(req: LlmStreamRequest): AsyncIterable<LlmChunk> {
    const primary = this.pick(this.defaultName);
    let started = false;
    try {
      for await (const chunk of primary.stream(req)) {
        started = true;
        yield chunk;
      }
      return;
    } catch (err) {
      const providerErr = this.toProviderError(err, primary.name);
      if (started || !this.shouldFallback(providerErr)) throw providerErr;
      const fb = this.pickFallback();
      if (!fb) throw providerErr;
      this.logger.warn(
        { from: primary.name, to: fb.name, reason: providerErr.reason },
        'Falling back to secondary LLM provider (stream not yet started)',
      );
      for await (const chunk of fb.stream(req)) yield chunk;
    }
  }

  /**
   * Probes the currently configured default provider. Used by
   * `LlmHealthIndicator` — routing failover is deliberately not exercised
   * here: /readiness should reflect the default's status so ops sees the same
   * signal callers do.
   */
  pingDefault(timeoutMs: number): Promise<void> {
    return this.pick(this.defaultName).ping(timeoutMs);
  }

  private pick(name: LlmProviderName): LlmProvider {
    return name === 'anthropic' ? this.anthropic : this.openai;
  }

  private pickFallback(): LlmProvider | undefined {
    return this.fallbackName ? this.pick(this.fallbackName) : undefined;
  }

  private shouldFallback(err: LlmProviderError): boolean {
    return err.isRetryable();
  }

  private toProviderError(err: unknown, providerName: LlmProviderName): LlmProviderError {
    if (err instanceof LlmProviderError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new LlmProviderError('unknown', providerName, message, err);
  }
}
