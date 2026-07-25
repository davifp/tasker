'use client';

import type { ReactionEmoji } from '@tasker/config';
import { ReactionBar } from './ReactionBar';
import { useReactions } from './useReactions';
import { useToggleReaction } from './useReactionMutations';

interface CommentReactionsProps {
  workspaceSlug: string;
  projectSlug: string;
  taskNumber: number;
  commentId: string;
  currentUserId: string;
  currentUserDisplayName?: string;
}

/**
 * Per-comment wrapper that composes ReactionBar + list-query + toggle-mutation.
 * Kept dumb-ish so the composer/panel do not need to know about mutation
 * plumbing.
 */
export function CommentReactions({
  workspaceSlug,
  projectSlug,
  taskNumber,
  commentId,
  currentUserId,
  currentUserDisplayName,
}: CommentReactionsProps) {
  const { data } = useReactions({ workspaceSlug, projectSlug, taskNumber, commentId });
  const toggle = useToggleReaction({
    workspaceSlug,
    projectSlug,
    taskNumber,
    commentId,
    currentUserId,
    currentUserDisplayName,
  });

  const summaries = data ?? [];

  return (
    <ReactionBar
      summaries={summaries}
      disabled={toggle.isPending}
      onToggle={(emoji: ReactionEmoji) => {
        const existing = summaries.find((s) => s.emoji === emoji);
        const add = !existing?.reactedByMe;
        toggle.mutate({ emoji, add });
      }}
    />
  );
}
