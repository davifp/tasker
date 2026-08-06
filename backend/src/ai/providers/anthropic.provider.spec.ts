import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AnthropicLlmProvider } from './anthropic.provider';
import { LlmProviderError, LlmStreamRequest, LlmStructuredRequest } from './llm-provider.port';

function makeConfig(): ConfigService {
  return {
    get: () => 'test-key',
  } as unknown as ConfigService;
}

interface FakeMessages {
  create: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
}

function fakeClient(messages: FakeMessages): Anthropic {
  return { messages } as unknown as Anthropic;
}

const structuredReq: LlmStructuredRequest<{ answer: string }> = {
  workspaceId: 'ws-1',
  cacheKey: 'workspace:ws-1',
  systemBlocks: [
    { text: 'preface', cache: { ttl: '1h' } },
    { text: 'instruction', cache: { ttl: '5m' } },
    { text: 'volatile' },
  ],
  userMessage: 'user',
  maxTokens: 512,
  schema: z.object({ answer: z.string() }),
  schemaName: 'result',
  schemaDescription: 'The result',
};

const streamReq: LlmStreamRequest = {
  workspaceId: 'ws-1',
  cacheKey: 'workspace:ws-1',
  systemBlocks: [{ text: 'sys', cache: { ttl: '1h' } }],
  userMessage: 'user',
  maxTokens: 128,
};

describe('AnthropicLlmProvider', () => {
  describe('complete', () => {
    it('maps prompt cache markers to Anthropic cache_control on the corresponding system block', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'result', input: { answer: 'ok' } }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 12, output_tokens: 8, cache_read_input_tokens: 4 },
      });
      const provider = new AnthropicLlmProvider(
        makeConfig(),
        fakeClient({ create, stream: vi.fn() }),
      );

      const result = await provider.complete(structuredReq);

      expect(result.value).toEqual({ answer: 'ok' });
      expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 8, cachedInputTokens: 4 });

      const req = create.mock.calls[0][0];
      expect(req.system[0]).toMatchObject({
        type: 'text',
        text: 'preface',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      });
      expect(req.system[1]).toMatchObject({
        cache_control: { type: 'ephemeral', ttl: '5m' },
      });
      // The volatile block MUST NOT get a cache marker.
      expect(req.system[2]).toEqual({ type: 'text', text: 'volatile' });
      // Structured mode MUST force the tool.
      expect(req.tool_choice).toEqual({ type: 'tool', name: 'result' });
      expect(req.tools[0].name).toBe('result');
      expect(req.tools[0].input_schema).toBeDefined();
    });

    it('throws LlmProviderError(validation) when the tool_use block is missing', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'no tool use for you' }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 3, output_tokens: 3 },
      });
      const provider = new AnthropicLlmProvider(
        makeConfig(),
        fakeClient({ create, stream: vi.fn() }),
      );
      await expect(provider.complete(structuredReq)).rejects.toMatchObject({
        reason: 'validation',
      });
    });

    it('throws LlmProviderError(validation) when the tool input fails Zod', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'result', input: { answer: 123 } }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 3, output_tokens: 3 },
      });
      const provider = new AnthropicLlmProvider(
        makeConfig(),
        fakeClient({ create, stream: vi.fn() }),
      );
      await expect(provider.complete(structuredReq)).rejects.toMatchObject({
        reason: 'validation',
      });
    });

    it('wraps rate-limit errors as reason=rate_limited', async () => {
      const err = Object.create(Anthropic.RateLimitError.prototype);
      err.message = 'slow down';
      const create = vi.fn().mockRejectedValue(err);
      const provider = new AnthropicLlmProvider(
        makeConfig(),
        fakeClient({ create, stream: vi.fn() }),
      );
      await expect(provider.complete(structuredReq)).rejects.toMatchObject({
        reason: 'rate_limited',
      });
    });

    it('wraps connection errors as reason=network', async () => {
      const err = Object.create(Anthropic.APIConnectionError.prototype);
      err.message = 'ECONNRESET';
      const create = vi.fn().mockRejectedValue(err);
      const provider = new AnthropicLlmProvider(
        makeConfig(),
        fakeClient({ create, stream: vi.fn() }),
      );
      await expect(provider.complete(structuredReq)).rejects.toMatchObject({ reason: 'network' });
    });

    it('wraps unclassified errors as reason=unknown', async () => {
      const create = vi.fn().mockRejectedValue(new Error('surprise'));
      const provider = new AnthropicLlmProvider(
        makeConfig(),
        fakeClient({ create, stream: vi.fn() }),
      );
      const promise = provider.complete(structuredReq);
      await expect(promise).rejects.toBeInstanceOf(LlmProviderError);
      await expect(promise).rejects.toMatchObject({ reason: 'unknown' });
    });
  });

  describe('stream', () => {
    it('emits text deltas and a terminal chunk with usage', async () => {
      const events = [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
        { type: 'message_stop' },
      ];
      const finalMessage = {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 1 },
      };
      const streamHandle = {
        // Consumed by the `for await` in the adapter.
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e;
        },
        finalMessage: () => Promise.resolve(finalMessage),
      };
      const provider = new AnthropicLlmProvider(
        makeConfig(),
        fakeClient({ create: vi.fn(), stream: vi.fn().mockReturnValue(streamHandle) }),
      );

      const chunks = [];
      for await (const chunk of provider.stream(streamReq)) chunks.push(chunk);

      expect(chunks.map((c) => c.delta).join('')).toBe('Hello');
      const terminal = chunks.at(-1);
      expect(terminal?.done).toBe(true);
      expect(terminal?.usage).toEqual({ inputTokens: 5, outputTokens: 2, cachedInputTokens: 1 });
      expect(terminal?.model).toBe('claude-sonnet-4-6');
    });
  });

  describe('ping', () => {
    it('lists models with the abort signal forwarded from the timeout', async () => {
      const list = vi.fn().mockResolvedValue({ data: [] });
      const client = { models: { list }, messages: {} } as unknown as Anthropic;
      const provider = new AnthropicLlmProvider(makeConfig(), client);

      await provider.ping(1000);

      const [args, opts] = list.mock.calls[0] ?? [];
      expect(args).toEqual({ limit: 1 });
      expect(opts?.signal).toBeInstanceOf(AbortSignal);
    });

    it('rejects when the underlying call rejects', async () => {
      const list = vi.fn().mockRejectedValue(new Error('unauthorized'));
      const client = { models: { list }, messages: {} } as unknown as Anthropic;
      const provider = new AnthropicLlmProvider(makeConfig(), client);

      await expect(provider.ping(1000)).rejects.toThrow('unauthorized');
    });
  });
});
