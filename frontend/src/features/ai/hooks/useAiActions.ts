'use client';

import { useMutation } from '@tanstack/react-query';
import { aiHttp, type EstimateAndSuggestResponse } from '@/lib/http/ai';
import { useSseStream } from './useSseStream';

/**
 * Streaming "Generate description" — the body carries the task title plus
 * optional context (project name, labels, related task titles) so the
 * server can enrich the prompt without extra round-trips.
 */
export function useGenerateDescription(workspaceSlug: string, taskId: string) {
  return useSseStream(`/workspaces/${workspaceSlug}/ai/tasks/${taskId}/generate-description`);
}

/**
 * Streaming "Summarize discussion" — no request body; the server pulls the
 * task's comment thread by id.
 */
export function useSummarizeThread(workspaceSlug: string, taskId: string) {
  return useSseStream(`/workspaces/${workspaceSlug}/ai/tasks/${taskId}/comments/summarize`);
}

/**
 * Structured "Generate checklist" — the terminal SSE `event: result` frame
 * carries `{ invocationId, items[] }`. Callers read `result` off the
 * `useSseStream` state once `status === 'done'`.
 */
export function useGenerateChecklist(workspaceSlug: string, taskId: string) {
  return useSseStream(`/workspaces/${workspaceSlug}/ai/tasks/${taskId}/generate-checklist`);
}

/**
 * Non-streaming "Estimate + suggest" — one POST, one JSON body.
 */
export function useEstimateAndSuggest(workspaceSlug: string, taskId: string) {
  return useMutation<EstimateAndSuggestResponse, unknown, void>({
    mutationFn: () => aiHttp.estimateAndSuggest(workspaceSlug, taskId),
  });
}

/**
 * 👍 / 👎 feedback on a specific invocation. Optional free-text on 👎.
 */
export function useSubmitAiFeedback(workspaceSlug: string) {
  return useMutation<
    { id: string },
    unknown,
    { invocationId: string; rating: 'POSITIVE' | 'NEGATIVE'; reason?: string }
  >({
    mutationFn: (body) => aiHttp.submitFeedback(workspaceSlug, body),
  });
}
