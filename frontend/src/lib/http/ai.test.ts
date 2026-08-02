import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openAiStream } from './ai';
import { HttpError } from './errors';

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('openAiStream', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('yields message + result frames and returns on `done`', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse([
        'event: message\ndata: hel\n\n',
        'event: message\ndata: lo\n\n',
        'event: result\ndata: {"invocationId":"inv-1"}\n\n',
        'event: done\ndata: {}\n\n',
      ]),
    );

    const frames = [];
    for await (const frame of openAiStream('/workspaces/w/ai/tasks/t/generate-description')) {
      frames.push(frame);
    }

    expect(frames).toEqual([
      { event: 'message', data: 'hel' },
      { event: 'message', data: 'lo' },
      { event: 'result', data: '{"invocationId":"inv-1"}' },
    ]);
  });

  it('handles frames split across multiple chunks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse(['event: message\n', 'data: partial', ' text\n\n', 'event: done\ndata: {}\n\n']),
    );

    const frames = [];
    for await (const frame of openAiStream('/x')) frames.push(frame);

    expect(frames).toEqual([{ event: 'message', data: 'partial text' }]);
  });

  it('throws HttpError built from Problem Details in an error frame', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse([
        'event: error\ndata: {"type":"about:blank#ai-budget-exhausted","title":"Budget exhausted","status":429}\n\n',
      ]),
    );

    await expect(async () => {
      for await (const _ of openAiStream('/x')) {
        /* noop */
      }
    }).rejects.toMatchObject({
      type: 'about:blank#ai-budget-exhausted',
      status: 429,
    });
  });

  it('throws HttpError built from response when status is non-2xx', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: 'about:blank#ai-consent-required',
          title: 'Consent required',
          status: 403,
        }),
        { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    );

    await expect(async () => {
      for await (const _ of openAiStream('/x')) {
        /* noop */
      }
    }).rejects.toBeInstanceOf(HttpError);
  });

  it('prefixes path with /api/proxy and forwards body + signal', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(sseResponse(['event: done\ndata: {}\n\n']));

    const controller = new AbortController();
    const gen = openAiStream('/workspaces/w/ai/x', { body: { a: 1 }, signal: controller.signal });
    // exhaust the generator
    for await (const _ of gen) {
      /* noop */
    }

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/proxy/workspaces/w/ai/x');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ a: 1 }));
    expect((init as RequestInit).signal).toBe(controller.signal);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Accept).toBe('text/event-stream');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
