import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { SseFrame } from '@/lib/http/ai';
import { HttpError } from '@/lib/http/errors';

// The hook only sees `openAiStream` — mocking it isolates the test from
// fetch/ReadableStream plumbing (which is exercised in ai.test.ts).
const mockOpenAiStream =
  vi.fn<
    (path: string, options?: { body?: unknown; signal?: AbortSignal }) => AsyncGenerator<SseFrame>
  >();

vi.mock('@/lib/http/ai', () => ({
  openAiStream: (path: string, options?: { body?: unknown; signal?: AbortSignal }) =>
    mockOpenAiStream(path, options),
}));

import { useSseStream } from './useSseStream';

async function* frames(items: SseFrame[]): AsyncGenerator<SseFrame> {
  for (const item of items) {
    // let React flush between deltas
    await Promise.resolve();
    yield item;
  }
}

async function* rejectWith(err: unknown): AsyncGenerator<SseFrame> {
  await Promise.resolve();
  throw err;

  yield { event: 'message', data: '' };
}

describe('useSseStream', () => {
  beforeEach(() => {
    mockOpenAiStream.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts idle', () => {
    const { result } = renderHook(() => useSseStream('/ai/x'));
    expect(result.current.status).toBe('idle');
    expect(result.current.text).toBe('');
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('accumulates message deltas and parses the result frame, ending in done', async () => {
    mockOpenAiStream.mockReturnValueOnce(
      frames([
        { event: 'message', data: 'hel' },
        { event: 'message', data: 'lo' },
        { event: 'result', data: '{"invocationId":"inv-1"}' },
      ]),
    );

    const { result } = renderHook(() => useSseStream('/ai/x'));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('done');
    expect(result.current.text).toBe('hello');
    expect(result.current.result).toEqual({ invocationId: 'inv-1' });
    expect(result.current.error).toBeNull();
  });

  it('translates a malformed result frame into an ai-invalid-response error', async () => {
    mockOpenAiStream.mockReturnValueOnce(frames([{ event: 'result', data: 'not-json' }]));

    const { result } = renderHook(() => useSseStream('/ai/x'));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.type).toBe('about:blank#ai-invalid-response');
  });

  it('propagates HttpError from the stream as-is', async () => {
    const problem = new HttpError({
      type: 'about:blank#ai-budget-exhausted',
      title: 'Budget exhausted',
      status: 429,
    });
    mockOpenAiStream.mockReturnValueOnce(rejectWith(problem));

    const { result } = renderHook(() => useSseStream('/ai/x'));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(problem);
  });

  it('wraps non-HttpError failures as ai-provider-unavailable', async () => {
    mockOpenAiStream.mockReturnValueOnce(rejectWith(new Error('boom')));

    const { result } = renderHook(() => useSseStream('/ai/x'));
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.type).toBe('about:blank#ai-provider-unavailable');
    expect(result.current.error?.detail).toBe('boom');
  });

  it('forwards body to openAiStream and passes an AbortSignal', async () => {
    mockOpenAiStream.mockReturnValueOnce(frames([]));

    const { result } = renderHook(() => useSseStream('/ai/x'));
    await act(async () => {
      await result.current.start({ title: 'demo' });
    });

    expect(mockOpenAiStream).toHaveBeenCalledTimes(1);
    const [path, options] = mockOpenAiStream.mock.calls[0]!;
    expect(path).toBe('/ai/x');
    expect(options?.body).toEqual({ title: 'demo' });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('abort() cancels an in-flight stream and reports aborted status', async () => {
    let signalCaptured: AbortSignal | undefined;
    mockOpenAiStream.mockImplementationOnce((_path, options) => {
      signalCaptured = options?.signal;
      return (async function* (): AsyncGenerator<SseFrame> {
        while (true) {
          if (signalCaptured?.aborted) {
            const err = new Error('aborted');
            (err as Error & { name: string }).name = 'AbortError';
            throw err;
          }
          await new Promise((r) => setTimeout(r, 5));
        }
      })();
    });

    const { result } = renderHook(() => useSseStream('/ai/x'));
    void act(() => {
      void result.current.start();
    });

    await waitFor(() => expect(result.current.status).toBe('streaming'));

    act(() => {
      result.current.abort();
    });

    await waitFor(() => expect(result.current.status).toBe('aborted'));
    expect(signalCaptured?.aborted).toBe(true);
  });

  it('reset() clears state', async () => {
    mockOpenAiStream.mockReturnValueOnce(frames([{ event: 'message', data: 'hi' }]));

    const { result } = renderHook(() => useSseStream('/ai/x'));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.text).toBe('hi');

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.text).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('aborts on unmount', async () => {
    let signal: AbortSignal | undefined;
    mockOpenAiStream.mockImplementationOnce((_path, options) => {
      signal = options?.signal;
      return (async function* (): AsyncGenerator<SseFrame> {
        while (!options?.signal?.aborted) await new Promise((r) => setTimeout(r, 5));
      })();
    });

    const { result, unmount } = renderHook(() => useSseStream('/ai/x'));
    void act(() => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.status).toBe('streaming'));

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
