'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HttpError } from '@/lib/http/errors';
import { openAiStream } from '@/lib/http/ai';

export interface UseSseStreamState {
  /** Concatenated deltas from `event: message` frames. */
  text: string;
  /** Parsed payload from the terminal `event: result` frame (if any). */
  result: unknown | null;
  status: 'idle' | 'streaming' | 'done' | 'error' | 'aborted';
  error: HttpError | null;
}

export interface UseSseStreamHandle extends UseSseStreamState {
  /** Kick off (or restart) the stream with the given POST body. */
  start: (body?: unknown) => Promise<void>;
  /** Cancel an in-flight stream — releases the AbortController immediately. */
  abort: () => void;
  reset: () => void;
}

const INITIAL: UseSseStreamState = { text: '', result: null, status: 'idle', error: null };

/**
 * SSE consumer that (unlike `EventSource`) sends credentialed POSTs, so it
 * works against the app's cookie-authenticated proxy and supports canceling
 * mid-stream via `AbortController`.
 *
 * Two terminal signals:
 *
 *  - `event: done` → `status = 'done'`.
 *  - `event: error` → the stream throws an `HttpError` built from the
 *    Problem Details payload; the caller renders the standard error banner.
 *
 * Interstitial signals:
 *
 *  - `event: message` → append to `text` (used by generate-description /
 *    summarize).
 *  - `event: result` → parse JSON and store in `result` (used by
 *    generate-checklist).
 */
export function useSseStream(path: string): UseSseStreamHandle {
  const [state, setState] = useState<UseSseStreamState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      setState((s) => (s.status === 'streaming' ? { ...s, status: 'aborted' } : s));
    }
  }, []);

  const reset = useCallback(() => {
    abort();
    setState(INITIAL);
  }, [abort]);

  const start = useCallback(
    async (body?: unknown) => {
      abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ text: '', result: null, status: 'streaming', error: null });
      try {
        for await (const frame of openAiStream(path, { body, signal: controller.signal })) {
          if (frame.event === 'message') {
            setState((s) => ({ ...s, text: s.text + frame.data }));
          } else if (frame.event === 'result') {
            let parsed: unknown;
            try {
              parsed = JSON.parse(frame.data);
            } catch {
              setState((s) => ({
                ...s,
                status: 'error',
                error: new HttpError({
                  type: 'about:blank#ai-invalid-response',
                  title: 'AI response was malformed',
                  status: 500,
                }),
              }));
              return;
            }
            setState((s) => ({ ...s, result: parsed }));
          }
        }
        setState((s) => ({ ...s, status: 'done' }));
      } catch (err) {
        if (controller.signal.aborted) {
          setState((s) => ({ ...s, status: 'aborted' }));
          return;
        }
        const httpErr =
          err instanceof HttpError
            ? err
            : new HttpError({
                type: 'about:blank#ai-provider-unavailable',
                title: 'AI provider unavailable',
                status: 503,
                detail: err instanceof Error ? err.message : undefined,
              });
        setState((s) => ({ ...s, status: 'error', error: httpErr }));
      } finally {
        controllerRef.current = null;
      }
    },
    [abort, path],
  );

  useEffect(() => () => abort(), [abort]);

  return { ...state, start, abort, reset };
}
