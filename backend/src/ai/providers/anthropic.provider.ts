import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema as zodToJsonSchemaImpl } from 'zod-to-json-schema';

// The library's generic surface tends to trigger TS2589 (`instantiation
// is excessively deep`) when the caller's Zod schema uses transforms or
// discriminated unions. We wrap the import in a broadly-typed shim so the
// call site never carries the deep generic through.
const zodToJsonSchema = zodToJsonSchemaImpl as unknown as (
  schema: ZodTypeAny,
  options?: Record<string, unknown>,
) => Record<string, unknown>;
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

/**
 * Default LLM provider (Anthropic). Owns two responsibilities that OpenAI
 * does not: it maps `PromptBlock.cache` to Anthropic's
 * `cache_control: { type: 'ephemeral', ttl }` markers on the corresponding
 * system block, and it maps the caller's Zod schema to a single-tool
 * `tool_use` call so structured outputs are validated at the provider
 * boundary rather than after generation.
 *
 * The adapter never throws provider-specific errors — every failure is wrapped
 * in `LlmProviderError` with a `reason` the router can key off. Aborts propagate
 * via the standard `AbortSignal` forwarded on the SDK options.
 */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6';

@Injectable()
export class AnthropicLlmProvider implements LlmProvider {
  readonly name: LlmProviderName = 'anthropic';

  private readonly logger = new Logger(AnthropicLlmProvider.name);
  private readonly client: Anthropic;

  constructor(config: ConfigService<Env, true>, @Optional() client?: Anthropic) {
    const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.client =
      client ??
      new Anthropic({
        apiKey: apiKey || 'missing-anthropic-api-key',
      });
  }

  async complete<T>(req: LlmStructuredRequest<T>): Promise<LlmStructuredResult<T>> {
    // `zodToJsonSchema` accepts a broadly-typed schema; the caller's generic
    // `ZodType<T>` narrows the parse phase but not the JSON schema emission.
    const inputSchema = zodToJsonSchema(req.schema as unknown as ZodTypeAny, {
      $refStrategy: 'none',
      target: 'openApi3',
    });

    try {
      const response = await this.client.messages.create(
        {
          model: req.model ?? ANTHROPIC_DEFAULT_MODEL,
          max_tokens: req.maxTokens,
          system: this.mapSystemBlocks(req.systemBlocks),
          messages: [{ role: 'user', content: req.userMessage }],
          tools: [
            {
              name: req.schemaName,
              description: req.schemaDescription,
              input_schema: inputSchema as Anthropic.Messages.Tool.InputSchema,
            },
          ],
          tool_choice: { type: 'tool', name: req.schemaName },
        },
        { signal: req.signal },
      );

      const toolBlock = response.content.find(
        (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
      );
      if (!toolBlock) {
        throw new LlmProviderError(
          'validation',
          this.name,
          'Anthropic response did not contain a tool_use block',
        );
      }

      const parsed = req.schema.safeParse(toolBlock.input);
      if (!parsed.success) {
        throw new LlmProviderError(
          'validation',
          this.name,
          `Structured output failed schema validation: ${parsed.error.message}`,
        );
      }

      return {
        value: parsed.data,
        model: response.model,
        usage: this.mapUsage(response.usage),
      };
    } catch (err) {
      throw this.toProviderError(err);
    }
  }

  async *stream(req: LlmStreamRequest): AsyncIterable<LlmChunk> {
    try {
      const stream = this.client.messages.stream(
        {
          model: req.model ?? ANTHROPIC_DEFAULT_MODEL,
          max_tokens: req.maxTokens,
          system: this.mapSystemBlocks(req.systemBlocks),
          messages: [{ role: 'user', content: req.userMessage }],
        },
        { signal: req.signal },
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { delta: event.delta.text, done: false };
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        delta: '',
        done: true,
        model: finalMessage.model,
        usage: this.mapUsage(finalMessage.usage),
      };
    } catch (err) {
      throw this.toProviderError(err);
    }
  }

  /**
   * Maps our neutral `PromptBlock[]` to Anthropic's system block shape.
   * `cache: { ttl }` becomes `cache_control: { type: 'ephemeral', ttl }` so
   * long-lived prefaces (`1h`) and per-action instructions (`5m`) sit on
   * their own cache boundaries.
   */
  private mapSystemBlocks(blocks: PromptBlock[]): Anthropic.Messages.TextBlockParam[] {
    return blocks.map((block) => {
      const param: Anthropic.Messages.TextBlockParam = { type: 'text', text: block.text };
      if (block.cache) {
        param.cache_control = { type: 'ephemeral', ttl: block.cache.ttl };
      }
      return param;
    });
  }

  private mapUsage(usage: Anthropic.Messages.Usage): LlmUsage {
    return {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cachedInputTokens:
        (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    };
  }

  /**
   * Classify SDK errors into the router's decision surface. Anthropic uses
   * distinct classes for rate-limit/overloaded/timeout so we can key off
   * `err.status` and `err.constructor.name`.
   */
  private toProviderError(err: unknown): LlmProviderError {
    if (err instanceof LlmProviderError) return err;

    if (err instanceof Anthropic.APIUserAbortError) {
      return new LlmProviderError('aborted', this.name, err.message, err);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return new LlmProviderError('rate_limited', this.name, err.message, err);
    }
    if (
      err instanceof Anthropic.InternalServerError ||
      (err instanceof Anthropic.APIError && err.status === 529)
    ) {
      return new LlmProviderError('overloaded', this.name, err.message, err);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return new LlmProviderError('network', this.name, err.message, err);
    }
    if (err instanceof Anthropic.APIError && err.status === 400) {
      return new LlmProviderError('validation', this.name, err.message, err);
    }
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn({ err }, 'Unclassified Anthropic error');
    return new LlmProviderError('unknown', this.name, message, err);
  }
}
