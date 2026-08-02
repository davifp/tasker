import { HttpError } from './errors';
import { browserHttp } from './browser';

/**
 * Backend-facing surface for Phase 9 AI actions. Non-streaming endpoints go
 * through the standard `browserHttp` helper; the two SSE endpoints
 * (generate-description, summarize) are consumed via `openAiStream()` — the
 * built-in `EventSource` cannot POST or send credentials, so we hand-roll
 * `fetch` + `ReadableStream` here.
 */

export interface AiUsageSnapshot {
  workspaceId: string;
  billingMonth: string;
  tokensBudget: number;
  tokensReserved: number;
  tokensConsumed: number;
  consent: {
    accepted: boolean;
    acceptedDocumentVersion?: string;
    requiredDocumentVersion: string;
    acceptedAt?: string;
    acceptedByUserId?: string;
  };
}

export interface EstimateAndSuggestResponse {
  invocationId: string;
  result: {
    estimate: { low: number; high: number; confidence: 'low' | 'medium' | 'high' };
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    assignees: Array<{ userId: string; reason: string }>;
    insufficientContext: boolean;
  };
}

export interface GenerateChecklistResponse {
  invocationId: string;
  items: string[];
}

export const aiHttp = {
  getUsage: (workspaceSlug: string) =>
    browserHttp.get<AiUsageSnapshot>(`/workspaces/${workspaceSlug}/ai/usage`),

  acceptConsent: (workspaceSlug: string, documentVersion: string, idempotencyKey?: string) =>
    browserHttp.post<void>(
      `/workspaces/${workspaceSlug}/ai/consent`,
      { documentVersion },
      { idempotencyKey },
    ),

  submitFeedback: (
    workspaceSlug: string,
    body: { invocationId: string; rating: 'POSITIVE' | 'NEGATIVE'; reason?: string },
  ) => browserHttp.post<{ id: string }>(`/workspaces/${workspaceSlug}/ai/feedback`, body),

  estimateAndSuggest: (workspaceSlug: string, taskId: string) =>
    browserHttp.post<EstimateAndSuggestResponse>(
      `/workspaces/${workspaceSlug}/ai/tasks/${taskId}/estimate-and-suggest`,
      {},
    ),
} as const;

// ---------------------------------------------------------------------------
// SSE streaming
// ---------------------------------------------------------------------------

export interface SseFrame {
  event: string;
  data: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
  body?: unknown;
}

/**
 * Opens a POST request to an AI SSE endpoint and yields parsed frames.
 * The endpoint URL is passed relative to `/api/proxy` (same as `browserHttp`),
 * so credentials + cookie forwarding come for free.
 *
 * Terminal frames:
 *   - `event: done` → generator returns normally.
 *   - `event: error` → generator throws `HttpError` built from the Problem
 *     Details payload in the frame's `data`.
 *
 * Non-terminal frames (`event: message`, `event: result`, ...) are yielded
 * to the caller as-is; the caller decides how to combine deltas.
 */
export async function* openAiStream(
  path: string,
  options: StreamOptions = {},
): AsyncGenerator<SseFrame, void, void> {
  const response = await fetch(`/api/proxy${path.startsWith('/') ? path : `/${path}`}`, {
    method: 'POST',
    credentials: 'same-origin',
    signal: options.signal,
    headers: {
      Accept: 'text/event-stream',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok || !response.body) {
    throw await HttpError.fromResponse(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = drainFrames(buffer);
      buffer = frames.remainder;
      for (const frame of frames.parsed) {
        if (frame.event === 'error') {
          throw parseProblemDetailsFrame(frame);
        }
        if (frame.event === 'done') return;
        yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function drainFrames(buffer: string): { parsed: SseFrame[]; remainder: string } {
  const parsed: SseFrame[] = [];
  let cursor = 0;
  while (true) {
    const boundary = buffer.indexOf('\n\n', cursor);
    if (boundary === -1) break;
    const chunk = buffer.slice(cursor, boundary);
    cursor = boundary + 2;
    const frame = parseFrame(chunk);
    if (frame) parsed.push(frame);
  }
  return { parsed, remainder: buffer.slice(cursor) };
}

function parseFrame(chunk: string): SseFrame | null {
  const lines = chunk.split('\n').filter((l) => l.length > 0);
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

function parseProblemDetailsFrame(frame: SseFrame): HttpError {
  try {
    const problem = JSON.parse(frame.data) as {
      type?: string;
      title?: string;
      status?: number;
      detail?: string;
      traceId?: string;
    };
    return new HttpError({
      type: problem.type ?? 'about:blank',
      title: problem.title ?? 'AI action failed',
      status: problem.status ?? 500,
      detail: problem.detail,
      traceId: problem.traceId,
    });
  } catch {
    return new HttpError({ type: 'about:blank', title: 'AI action failed', status: 500 });
  }
}
