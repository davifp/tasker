'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiHttp, type AiUsageSnapshot } from '@/lib/http/ai';

export const aiKeys = {
  usage: (workspaceSlug: string) => ['ai', workspaceSlug, 'usage'] as const,
} as const;

/**
 * Snapshot of the workspace's current-month AI budget + consent status.
 * Runs only for authenticated admins — the endpoint returns 403 for
 * non-admins, and the consumers gate the query with `enabled`.
 */
export function useAiUsage(workspaceSlug: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery<AiUsageSnapshot>({
    queryKey: aiKeys.usage(workspaceSlug ?? 'unknown'),
    queryFn: () => aiHttp.getUsage(workspaceSlug!),
    enabled: (opts.enabled ?? true) && Boolean(workspaceSlug),
    staleTime: 60_000,
  });
}

/**
 * Admin action: accept the current consent document version so AI actions
 * unlock for the whole workspace. Invalidates the usage snapshot on
 * success so the banner + menu update immediately.
 */
export function useAcceptAiConsent(workspaceSlug: string, documentVersion: string) {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, void>({
    mutationFn: () =>
      aiHttp.acceptConsent(
        workspaceSlug,
        documentVersion,
        // Idempotency-Key covers the double-click on the acceptance modal.
        `ai-consent-${workspaceSlug}-${documentVersion}`,
      ),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: aiKeys.usage(workspaceSlug) });
    },
  });
}
