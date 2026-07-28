import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AnthropicLlmProvider } from './anthropic.provider';
import { LlmProviderName, LlmStructuredRequest } from './llm-provider.port';
import { LlmRouter } from './llm-router';
import { OpenAiLlmProvider } from './openai.provider';

/**
 * End-to-end wiring test: real `LlmRouter` + real adapters + mocked SDK
 * clients. Complements the unit specs by exercising the classification →
 * fallback → adapter mapping chain in one shot, which is the exact path a
 * production request follows minus the network.
 */

function makeConfig(defaultName: LlmProviderName, fallbackName?: LlmProviderName): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'AI_DEFAULT_PROVIDER') return defaultName;
      if (key === 'AI_FALLBACK_PROVIDER') return fallbackName;
      if (key === 'ANTHROPIC_API_KEY') return 'test';
      if (key === 'OPENAI_API_KEY') return 'test';
      return undefined;
    },
  } as unknown as ConfigService;
}

const structuredReq: LlmStructuredRequest<{ ok: boolean }> = {
  workspaceId: 'ws-1',
  cacheKey: 'workspace:ws-1',
  systemBlocks: [{ text: 'sys', cache: { ttl: '1h' } }],
  userMessage: 'user',
  maxTokens: 128,
  schema: z.object({ ok: z.boolean() }),
  schemaName: 'result',
  schemaDescription: 'a result',
};

describe('LlmRouter → adapters (integration)', () => {
  it('classifies an Anthropic overload as retryable and falls back to OpenAI', async () => {
    const overloaded = Object.create(Anthropic.InternalServerError.prototype);
    overloaded.message = 'overloaded';
    overloaded.status = 529;
    const anthropicCreate = vi.fn().mockRejectedValue(overloaded);
    const anthropicClient = {
      messages: { create: anthropicCreate, stream: vi.fn() },
    } as unknown as Anthropic;

    const openaiCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const openaiClient = {
      chat: { completions: { create: openaiCreate } },
    } as unknown as OpenAI;

    const anthropic = new AnthropicLlmProvider(makeConfig('anthropic', 'openai'), anthropicClient);
    const openai = new OpenAiLlmProvider(makeConfig('anthropic', 'openai'), openaiClient);
    const router = new LlmRouter(makeConfig('anthropic', 'openai'), anthropic, openai);

    const out = await router.complete(structuredReq);

    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(out.provider).toBe('openai');
    expect(out.fallbackReason).toBe('overloaded');
    expect(out.value.value).toEqual({ ok: true });
  });

  it('propagates Anthropic validation errors without falling back', async () => {
    // Semantic failure — retrying against OpenAI won't fix it.
    const anthropicCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'no tool_use here' }],
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const anthropicClient = {
      messages: { create: anthropicCreate, stream: vi.fn() },
    } as unknown as Anthropic;

    const openaiCreate = vi.fn();
    const openaiClient = {
      chat: { completions: { create: openaiCreate } },
    } as unknown as OpenAI;

    const anthropic = new AnthropicLlmProvider(makeConfig('anthropic', 'openai'), anthropicClient);
    const openai = new OpenAiLlmProvider(makeConfig('anthropic', 'openai'), openaiClient);
    const router = new LlmRouter(makeConfig('anthropic', 'openai'), anthropic, openai);

    await expect(router.complete(structuredReq)).rejects.toMatchObject({
      reason: 'validation',
      provider: 'anthropic',
    });
    expect(openaiCreate).not.toHaveBeenCalled();
  });
});
