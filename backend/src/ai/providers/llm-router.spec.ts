import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  LlmChunk,
  LlmProvider,
  LlmProviderError,
  LlmProviderName,
  LlmStreamRequest,
  LlmStructuredRequest,
  LlmStructuredResult,
} from './llm-provider.port';
import { LlmRouter } from './llm-router';

function makeConfig(defaultName: LlmProviderName, fallbackName?: LlmProviderName): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'AI_DEFAULT_PROVIDER') return defaultName;
      if (key === 'AI_FALLBACK_PROVIDER') return fallbackName;
      return undefined;
    },
  } as unknown as ConfigService;
}

class FakeProvider implements LlmProvider {
  readonly name: LlmProviderName;
  complete = vi.fn<(req: LlmStructuredRequest<unknown>) => Promise<LlmStructuredResult<unknown>>>();
  stream = vi.fn<(req: LlmStreamRequest) => AsyncIterable<LlmChunk>>();

  constructor(name: LlmProviderName) {
    this.name = name;
  }
}

const structuredReq: LlmStructuredRequest<{ ok: boolean }> = {
  workspaceId: 'ws-1',
  cacheKey: 'workspace:ws-1',
  systemBlocks: [{ text: 'sys' }],
  userMessage: 'user',
  maxTokens: 100,
  schema: z.object({ ok: z.boolean() }),
  schemaName: 'result',
  schemaDescription: 'A result',
};

const streamReq: LlmStreamRequest = {
  workspaceId: 'ws-1',
  cacheKey: 'workspace:ws-1',
  systemBlocks: [{ text: 'sys' }],
  userMessage: 'user',
  maxTokens: 100,
};

describe('LlmRouter', () => {
  let anthropic: FakeProvider;
  let openai: FakeProvider;

  beforeEach(() => {
    anthropic = new FakeProvider('anthropic');
    openai = new FakeProvider('openai');
  });

  describe('constructor', () => {
    it('throws when default and fallback are the same provider', () => {
      expect(
        () =>
          new LlmRouter(
            makeConfig('anthropic', 'anthropic'),
            anthropic as unknown as never,
            openai as unknown as never,
          ),
      ).toThrow(/must differ/);
    });
  });

  describe('complete', () => {
    it('returns the primary result when the default provider succeeds', async () => {
      anthropic.complete.mockResolvedValue({
        value: { ok: true },
        model: 'claude',
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      });
      const router = new LlmRouter(
        makeConfig('anthropic', 'openai'),
        anthropic as unknown as never,
        openai as unknown as never,
      );

      const out = await router.complete(structuredReq);

      expect(out.provider).toBe('anthropic');
      expect(out.fallbackReason).toBeUndefined();
      expect(openai.complete).not.toHaveBeenCalled();
    });

    it.each([
      ['overloaded', 'overloaded' as const],
      ['rate_limited', 'rate_limited' as const],
      ['network', 'network' as const],
      ['unknown', 'unknown' as const],
    ])('falls back exactly once on %s errors', async (_label, reason) => {
      anthropic.complete.mockRejectedValue(new LlmProviderError(reason, 'anthropic', 'fail'));
      openai.complete.mockResolvedValue({
        value: { ok: true },
        model: 'gpt',
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      });

      const router = new LlmRouter(
        makeConfig('anthropic', 'openai'),
        anthropic as unknown as never,
        openai as unknown as never,
      );
      const out = await router.complete(structuredReq);

      expect(out.provider).toBe('openai');
      expect(out.fallbackReason).toBe(reason);
      expect(anthropic.complete).toHaveBeenCalledTimes(1);
      expect(openai.complete).toHaveBeenCalledTimes(1);
    });

    it.each([['validation' as const], ['refusal' as const], ['aborted' as const]])(
      'does NOT fall back on semantic error %s',
      async (reason) => {
        anthropic.complete.mockRejectedValue(new LlmProviderError(reason, 'anthropic', 'nope'));
        const router = new LlmRouter(
          makeConfig('anthropic', 'openai'),
          anthropic as unknown as never,
          openai as unknown as never,
        );

        await expect(router.complete(structuredReq)).rejects.toMatchObject({
          reason,
          provider: 'anthropic',
        });
        expect(openai.complete).not.toHaveBeenCalled();
      },
    );

    it('surfaces the primary error unchanged when no fallback is configured', async () => {
      anthropic.complete.mockRejectedValue(new LlmProviderError('overloaded', 'anthropic', 'busy'));
      const router = new LlmRouter(
        makeConfig('anthropic'),
        anthropic as unknown as never,
        openai as unknown as never,
      );

      await expect(router.complete(structuredReq)).rejects.toMatchObject({
        reason: 'overloaded',
      });
      expect(openai.complete).not.toHaveBeenCalled();
    });

    it('does not retry a second time when the fallback also fails', async () => {
      anthropic.complete.mockRejectedValue(new LlmProviderError('overloaded', 'anthropic', 'busy'));
      openai.complete.mockRejectedValue(new LlmProviderError('overloaded', 'openai', 'also busy'));
      const router = new LlmRouter(
        makeConfig('anthropic', 'openai'),
        anthropic as unknown as never,
        openai as unknown as never,
      );

      await expect(router.complete(structuredReq)).rejects.toMatchObject({
        provider: 'openai',
      });
      expect(anthropic.complete).toHaveBeenCalledTimes(1);
      expect(openai.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe('stream', () => {
    it('falls back when the primary fails BEFORE the first chunk', async () => {
      anthropic.stream.mockImplementation(async function* () {
        throw new LlmProviderError('overloaded', 'anthropic', 'busy');
      });
      openai.stream.mockImplementation(async function* () {
        yield { delta: 'hello', done: false };
        yield { delta: '', done: true };
      });

      const router = new LlmRouter(
        makeConfig('anthropic', 'openai'),
        anthropic as unknown as never,
        openai as unknown as never,
      );
      const chunks: LlmChunk[] = [];
      for await (const c of router.stream(streamReq)) chunks.push(c);

      expect(chunks.map((c) => c.delta).join('')).toBe('hello');
      expect(openai.stream).toHaveBeenCalledTimes(1);
    });

    it('does NOT fall back once bytes are on the wire', async () => {
      anthropic.stream.mockImplementation(async function* () {
        yield { delta: 'partial ', done: false };
        throw new LlmProviderError('overloaded', 'anthropic', 'died mid-stream');
      });
      openai.stream.mockImplementation(async function* () {
        yield { delta: 'never', done: false };
      });

      const router = new LlmRouter(
        makeConfig('anthropic', 'openai'),
        anthropic as unknown as never,
        openai as unknown as never,
      );
      const chunks: LlmChunk[] = [];
      await expect(async () => {
        for await (const c of router.stream(streamReq)) chunks.push(c);
      }).rejects.toMatchObject({ provider: 'anthropic', reason: 'overloaded' });

      expect(chunks.map((c) => c.delta).join('')).toBe('partial ');
      expect(openai.stream).not.toHaveBeenCalled();
    });
  });
});
