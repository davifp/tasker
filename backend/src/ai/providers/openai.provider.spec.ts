import { ConfigService } from '@nestjs/config';
import OpenAI, { APIConnectionError, APIError, RateLimitError } from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmProviderError, LlmStreamRequest, LlmStructuredRequest } from './llm-provider.port';
import { OpenAiLlmProvider } from './openai.provider';

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    OPENAI_API_KEY: 'test-key',
    AI_OPENAI_BASE_URL: undefined,
    AI_OPENAI_MODEL: undefined,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function fakeClient(chatCreate: ReturnType<typeof vi.fn>): OpenAI {
  return {
    chat: { completions: { create: chatCreate } },
  } as unknown as OpenAI;
}

const structuredReq: LlmStructuredRequest<{ answer: string }> = {
  workspaceId: 'ws-1',
  cacheKey: 'workspace:ws-1',
  systemBlocks: [
    { text: 'preface', cache: { ttl: '1h' } },
    { text: 'instruction', cache: { ttl: '5m' } },
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
  systemBlocks: [{ text: 'sys' }],
  userMessage: 'user',
  maxTokens: 128,
};

describe('OpenAiLlmProvider', () => {
  describe('env-driven baseURL + model', () => {
    it('passes AI_OPENAI_BASE_URL through to the OpenAI client so any compat provider works', () => {
      const provider = new OpenAiLlmProvider(
        makeConfig({ AI_OPENAI_BASE_URL: 'https://api.groq.com/openai/v1' }),
      );
      // OpenAI SDK exposes the resolved baseURL as an instance property; a
      // trailing slash may or may not be attached depending on the SDK
      // version, so match on prefix.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((provider as any).client.baseURL).toContain('api.groq.com/openai/v1');
    });

    it('uses AI_OPENAI_MODEL as the request default when no per-call model is set', async () => {
      const create = vi.fn().mockResolvedValue({
        choices: [{ message: { content: '{"answer":"ok"}' } }],
        model: 'llama-3.3-70b-versatile',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      const provider = new OpenAiLlmProvider(
        makeConfig({ AI_OPENAI_MODEL: 'llama-3.3-70b-versatile' }),
        fakeClient(create),
      );

      await provider.complete(structuredReq);

      expect(create.mock.calls[0][0].model).toBe('llama-3.3-70b-versatile');
    });

    it('per-call model still overrides the env default', async () => {
      const create = vi.fn().mockResolvedValue({
        choices: [{ message: { content: '{"answer":"ok"}' } }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      const provider = new OpenAiLlmProvider(
        makeConfig({ AI_OPENAI_MODEL: 'llama-3.3-70b-versatile' }),
        fakeClient(create),
      );

      await provider.complete({ ...structuredReq, model: 'gpt-4o' });

      expect(create.mock.calls[0][0].model).toBe('gpt-4o');
    });
  });

  describe('complete', () => {
    it('uses response_format.json_schema with strict:true and flattens system blocks', async () => {
      const create = vi.fn().mockResolvedValue({
        choices: [{ message: { content: '{"answer":"ok"}' } }],
        model: 'gpt-4o-mini',
        usage: {
          prompt_tokens: 20,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 8 },
        },
      });
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));

      const result = await provider.complete(structuredReq);

      expect(result.value).toEqual({ answer: 'ok' });
      expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 5, cachedInputTokens: 8 });

      const req = create.mock.calls[0][0];
      expect(req.response_format).toMatchObject({
        type: 'json_schema',
        json_schema: { name: 'result', strict: true },
      });
      // Flattened system content contains both blocks, cache markers dropped.
      expect(req.messages[0].role).toBe('system');
      expect(req.messages[0].content).toContain('preface');
      expect(req.messages[0].content).toContain('instruction');
      expect(req.messages[0].content).not.toContain('ttl');
    });

    it('tolerates JSON wrapped in ```json fences (common on free-tier models)', async () => {
      const create = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: '```json\n{"answer":"ok"}\n```',
            },
          },
        ],
        model: 'gemma',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));

      const result = await provider.complete(structuredReq);

      expect(result.value).toEqual({ answer: 'ok' });
    });

    it('extracts the outermost JSON object when the model adds prose around it', async () => {
      const create = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: 'Sure! Here is the JSON:\n{"answer":"ok"}\nHope that helps.',
            },
          },
        ],
        model: 'gemma',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));

      const result = await provider.complete(structuredReq);

      expect(result.value).toEqual({ answer: 'ok' });
    });

    it('rejects non-JSON content with reason=validation', async () => {
      const create = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'not json' } }],
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));
      await expect(provider.complete(structuredReq)).rejects.toMatchObject({
        reason: 'validation',
      });
    });

    it('rejects JSON that fails Zod validation with reason=validation', async () => {
      const create = vi.fn().mockResolvedValue({
        choices: [{ message: { content: '{"answer":42}' } }],
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));
      await expect(provider.complete(structuredReq)).rejects.toMatchObject({
        reason: 'validation',
      });
    });

    it('wraps rate limit errors as reason=rate_limited', async () => {
      const err = Object.create(RateLimitError.prototype);
      err.message = 'slow down';
      const create = vi.fn().mockRejectedValue(err);
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));
      await expect(provider.complete(structuredReq)).rejects.toMatchObject({
        reason: 'rate_limited',
      });
    });

    it('wraps connection errors as reason=network', async () => {
      const err = Object.create(APIConnectionError.prototype);
      err.message = 'ECONNRESET';
      const create = vi.fn().mockRejectedValue(err);
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));
      await expect(provider.complete(structuredReq)).rejects.toMatchObject({ reason: 'network' });
    });

    it('classifies APIError 503 as reason=overloaded', async () => {
      const err = Object.create(APIError.prototype);
      err.message = 'service unavailable';
      err.status = 503;
      const create = vi.fn().mockRejectedValue(err);
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));
      await expect(provider.complete(structuredReq)).rejects.toMatchObject({
        reason: 'overloaded',
      });
    });

    it('wraps unclassified errors as reason=unknown', async () => {
      const create = vi.fn().mockRejectedValue(new Error('nope'));
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));
      const promise = provider.complete(structuredReq);
      await expect(promise).rejects.toBeInstanceOf(LlmProviderError);
      await expect(promise).rejects.toMatchObject({ reason: 'unknown' });
    });
  });

  describe('stream', () => {
    it('emits deltas from chat completion chunks and a terminal chunk with usage', async () => {
      const chunks = [
        { model: 'gpt-4o-mini', choices: [{ delta: { content: 'He' } }] },
        { model: 'gpt-4o-mini', choices: [{ delta: { content: 'llo' } }] },
        {
          model: 'gpt-4o-mini',
          choices: [{ delta: {} }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 3,
            prompt_tokens_details: { cached_tokens: 4 },
          },
        },
      ];
      const create = vi.fn().mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const c of chunks) yield c;
        },
      });
      const provider = new OpenAiLlmProvider(makeConfig(), fakeClient(create));

      const out = [];
      for await (const chunk of provider.stream(streamReq)) out.push(chunk);

      expect(out.map((c) => c.delta).join('')).toBe('Hello');
      const terminal = out.at(-1);
      expect(terminal?.done).toBe(true);
      expect(terminal?.usage).toEqual({ inputTokens: 10, outputTokens: 3, cachedInputTokens: 4 });
      expect(terminal?.model).toBe('gpt-4o-mini');
    });
  });
});
