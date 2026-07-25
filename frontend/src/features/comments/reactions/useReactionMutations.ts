import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskKeys } from '@/features/queryKeys';
import { reactionsHttp } from '@/lib/http/reactions';
import type { ReactionEmoji } from '@tasker/config';
import type { ReactionSummary } from '@/lib/http/types';

interface Coords {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
  commentId: string;
  currentUserId: string;
  currentUserDisplayName?: string;
}

interface OptimisticContext {
  previous: ReactionSummary[] | undefined;
}

/**
 * Toggle mutation for a single (comment, emoji) pair. Optimistically updates
 * the summary rows: the same slug's count moves +/-1 and `reactedByMe`
 * flips. On failure the previous snapshot is restored.
 *
 * Kept idempotent from the caller's point of view: passing an emoji the user
 * already reacted with is a remove; the fresh emoji is an add. The backend
 * enforces the same idempotency at the row level.
 */
export function useToggleReaction(coords: Coords) {
  const queryClient = useQueryClient();
  const key = taskKeys.reactions(
    coords.workspaceSlug,
    coords.projectSlug,
    coords.taskNumber,
    coords.commentId,
  );
  const activityKey = taskKeys.activity(
    coords.workspaceSlug,
    coords.projectSlug,
    coords.taskNumber,
  );

  return useMutation<void, unknown, { emoji: ReactionEmoji; add: boolean }, OptimisticContext>({
    mutationFn: ({ emoji, add }) =>
      add
        ? reactionsHttp.add(
            coords.workspaceSlug,
            coords.projectSlug,
            coords.taskNumber,
            coords.commentId,
            emoji,
          )
        : reactionsHttp.remove(
            coords.workspaceSlug,
            coords.projectSlug,
            coords.taskNumber,
            coords.commentId,
            emoji,
          ),
    async onMutate({ emoji, add }) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ReactionSummary[]>(key);
      const next = applyOptimistic(previous ?? [], emoji, add, coords);
      queryClient.setQueryData<ReactionSummary[]>(key, next);
      return { previous };
    },
    onError(_err, _vars, ctx) {
      if (ctx?.previous !== undefined) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: activityKey });
    },
  });
}

function applyOptimistic(
  summaries: ReactionSummary[],
  emoji: ReactionEmoji,
  add: boolean,
  coords: Coords,
): ReactionSummary[] {
  const existing = summaries.find((s) => s.emoji === emoji);
  if (add) {
    if (existing?.reactedByMe) return summaries; // already reacted — no-op
    const reactor = {
      userId: coords.currentUserId,
      displayName: coords.currentUserDisplayName ?? '',
    };
    if (existing) {
      return summaries.map((s) =>
        s.emoji === emoji
          ? {
              ...s,
              count: s.count + 1,
              reactedByMe: true,
              reactorSample: [
                reactor,
                ...s.reactorSample.filter((r) => r.userId !== coords.currentUserId),
              ].slice(0, 5),
            }
          : s,
      );
    }
    return [
      ...summaries,
      {
        emoji,
        count: 1,
        reactedByMe: true,
        reactorSample: [reactor],
      },
    ];
  }
  if (!existing || !existing.reactedByMe) return summaries;
  const nextCount = Math.max(existing.count - 1, 0);
  if (nextCount === 0) return summaries.filter((s) => s.emoji !== emoji);
  return summaries.map((s) =>
    s.emoji === emoji
      ? {
          ...s,
          count: nextCount,
          reactedByMe: false,
          reactorSample: s.reactorSample.filter((r) => r.userId !== coords.currentUserId),
        }
      : s,
  );
}
