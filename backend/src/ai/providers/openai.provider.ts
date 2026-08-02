import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIError, APIConnectionError, APIUserAbortError, RateLimitError } from 'openai';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema as zodToJsonSchemaImpl } from 'zod-to-json-schema';
import type { Env } from '@tasker/config';
import {
  LlmChunk,
  LlmProvider,
  LlmProviderError,
  LlmProviderName,
  LlmStreamRequest,
  LlmStructuredRequest,
  LlmStructuredResult,
  LlmUsage,
  PromptBlock,
} from './llm-provider.port';

// Broadly-typed shim — same rationale as in `anthropic.provider.ts`: keeps
// deep Zod generics out of the call site so TS2589 does not fire.
const zodToJsonSchema = zodToJsonSchemaImpl as unknown as (
  schema: ZodTypeAny,
  options?: Record<string, unknown>,
) => Record<string, unknown>;

export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Fallback LLM provider (OpenAI). Uses `chat.completions` with streaming and
 * `response_format.json_schema` (strict) for structured outputs. OpenAI does
 * not expose per-block prompt-cache markers, so `PromptBlock.cache` is
 * flattened into a single system message; the provider's own cache is
 * content-hash driven and continues to work transparently.
 *
 * `AI_OPENAI_BASE_URL` + `AI_OPENAI_MODEL` let the adapter target any
 * OpenAI-compatible endpoint (Groq, OpenRouter, Mistral, Cerebras, Together,
 * DeepSeek, …) without a code change. Callers that pass an explicit
 * `req.model` still win; the env value is the default when none is set.
 */
@Injectable()
export class OpenAiLlmProvider implements LlmProvider {
  readonly name: LlmProviderName = 'openai';

  private readonly logger = new Logger(OpenAiLlmProvider.name);
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(config: ConfigService<Env, true>, @Optional() client?: OpenAI) {
    const apiKey = config.get('OPENAI_API_KEY', { infer: true });
    const baseURL = config.get('AI_OPENAI_BASE_URL', { infer: true });
    this.defaultModel = config.get('AI_OPENAI_MODEL', { infer: true }) ?? OPENAI_DEFAULT_MODEL;
    this.client =
      client ??
      new OpenAI({
        apiKey: apiKey || 'missing-openai-api-key',
        ...(baseURL ? { baseURL } : {}),
      });
  }

  async complete<T>(req: LlmStructuredRequest<T>): Promise<LlmStructuredResult<T>> {
    const schema = zodToJsonSchema(req.schema as unknown as ZodTypeAny, {
      $refStrategy: 'none',
      target: 'openApi3',
    });

    try {
      const response = await this.client.chat.completions.create(
        {
          model: req.model ?? this.defaultModel,
          max_tokens: req.maxTokens,
          messages: [
            { role: 'system', content: this.flattenSystemBlocks(req.systemBlocks) },
            { role: 'user', content: req.userMessage },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: req.schemaName,
              description: req.schemaDescription,
              schema,
              strict: true,
            },
          },
        },
        { signal: req.signal },
      );

      const raw = response.choices[0]?.message?.content;
      if (!raw) {
        throw new LlmProviderError(
          'validation',
          this.name,
          'OpenAI response did not contain any content',
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(raw));
      } catch (err) {
        throw new LlmProviderError(
          'validation',
          this.name,
          `Structured output was not valid JSON: ${(err as Error).message}`,
          err,
        );
      }
      const validated = req.schema.safeParse(parsed);
      if (!validated.success) {
        throw new LlmProviderError(
          'validation',
          this.name,
          `Structured output failed schema validation: ${validated.error.message}`,
        );
      }
      return {
        value: validated.data,
        model: response.model,
        usage: this.mapUsage(response.usage),
      };
    } catch (err) {
      throw this.toProviderError(err);
    }
  }

  async *stream(req: LlmStreamRequest): AsyncIterable<LlmChunk> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: req.model ?? this.defaultModel,
          max_tokens: req.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: this.flattenSystemBlocks(req.systemBlocks) },
            { role: 'user', content: req.userMessage },
          ],
        },
        { signal: req.signal },
      );

      let lastModel: string | undefined;
      let lastUsage: LlmUsage | undefined;
      for await (const chunk of stream) {
        lastModel ??= chunk.model;
        if (chunk.usage) lastUsage = this.mapUsage(chunk.usage);
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) yield { delta, done: false };
      }
      yield {
        delta: '',
        done: true,
        model: lastModel,
        usage: lastUsage ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      };
    } catch (err) {
      throw this.toProviderError(err);
    }
  }

  private flattenSystemBlocks(blocks: PromptBlock[]): string {
    return blocks.map((block) => block.text).join('\n\n');
  }

  private mapUsage(usage: OpenAI.Completions.CompletionUsage | undefined): LlmUsage {
    if (!usage) return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    return {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    };
  }

  private toProviderError(err: unknown): LlmProviderError {
    if (err instanceof LlmProviderError) return err;

    if (err instanceof APIUserAbortError) {
      return new LlmProviderError('aborted', this.name, err.message, err);
    }
    if (err instanceof RateLimitError) {
      return new LlmProviderError('rate_limited', this.name, err.message, err);
    }
    if (err instanceof APIError && (err.status === 503 || err.status === 529)) {
      return new LlmProviderError('overloaded', this.name, err.message, err);
    }
    if (err instanceof APIConnectionError) {
      return new LlmProviderError('network', this.name, err.message, err);
    }
    if (err instanceof APIError && err.status === 400) {
      return new LlmProviderError('validation', this.name, err.message, err);
    }
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn({ err }, 'Unclassified OpenAI error');
    return new LlmProviderError('unknown', this.name, message, err);
  }
}

// Small tolerance layer for free-tier / open-weights backends that don't
// strictly honor `response_format.json_schema` and wrap JSON in Markdown
// fences (```json … ```) or bracket it with prose. We prefer the largest
// balanced `{ … }` block after fence removal; on any structural surprise we
// return the trimmed input and let JSON.parse throw the real error.
function extractJson(raw: string): string {
  const withoutFences = raw
    .trim()
    .replace(/^```(?:json|jsonc)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return withoutFences.slice(start, end + 1);
  }
  return withoutFences;
}
