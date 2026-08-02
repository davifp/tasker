'use client';

import { useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Pencil, Trash2, X } from 'lucide-react';
import { useComments } from './hooks/useComments';
import { useAddComment, useDeleteComment, useEditComment } from './hooks/useCommentMutations';
import { MarkdownComposer } from './MarkdownComposer';
import { CommentReactions } from './reactions/CommentReactions';
import { useAnalytics } from '@/features/analytics/AnalyticsProvider';
import { Button } from '@/components/ui/button';
import { SafeMarkdown } from '@/components/markdown/SafeMarkdown';
import { HttpError } from '@/lib/http/errors';
import { AssigneeBubble } from '@/features/tasks/AssigneeBubble';
import type { WorkspaceRole } from '@/lib/http/types';
import { SummarizeThreadButton } from '@/features/ai/components/SummarizeThreadButton';
import { useAiUsage } from '@/features/ai/hooks/useAiUsage';

interface CommentsPanelProps {
  workspaceSlug: string;
  workspaceId: string;
  projectId: string;
  projectSlug: string;
  taskNumber: number;
  taskId: string;
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  currentUserDisplayName?: string;
}

function canManage(currentRole: WorkspaceRole, isAuthor: boolean): boolean {
  if (currentRole === 'OWNER' || currentRole === 'ADMIN') return true;
  return isAuthor;
}

export function CommentsPanel({
  workspaceSlug,
  workspaceId,
  projectId,
  projectSlug,
  taskNumber,
  taskId,
  currentUserId,
  currentUserRole,
  currentUserDisplayName,
}: CommentsPanelProps) {
  const t = useTranslations('board.comments');
  const locale = useLocale();
  const emit = useAnalytics();
  const coords = { workspaceSlug, projectSlug, taskNumber };
  const { data, isLoading } = useComments(workspaceSlug, projectSlug, taskNumber);
  const add = useAddComment(coords);
  const edit = useEditComment(coords);
  const remove = useDeleteComment(coords);

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  const items = useMemo(() => data ?? [], [data]);

  // Build a shared mentionMap from every comment's mentions so the preview
  // and rendered bodies can turn @slug into a pill. Missing slugs fall back
  // to the userId — the surface is still visible, the pill is still clickable.
  const mentionMap = useMemo(() => {
    const map: Record<string, { userId: string; displayName?: string }> = {};
    for (const comment of items) {
      for (const mention of comment.mentions ?? []) {
        // We only know the userId here — the display name arrives via
        // useMentionSearch cache in future work; keep the userId as label
        // for now so the pill renders.
        map[mention.userId] = { userId: mention.userId };
      }
    }
    return map;
  }, [items]);

  async function commitNew() {
    const body = draft.trim();
    if (!body) return;
    // Clear the composer immediately so the user can queue the next thought.
    // The mutation is optimistic — a rollback via setDraft(body) on error
    // restores the buffer without losing what they typed.
    setDraft('');
    try {
      const created = await add.mutateAsync({ body, authorUserId: currentUserId });
      emit({ name: 'comment_added', workspaceId, projectId, taskId, commentId: created.id });
    } catch (err) {
      setDraft(body);
      handleError(err, t('errors.addFailed'));
    }
  }

  async function commitEdit() {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body) return;
    try {
      await edit.mutateAsync({ id: editing.id, body });
      setEditing(null);
    } catch (err) {
      handleError(err, t('errors.editFailed'));
    }
  }

  function handleError(err: unknown, fallback: string) {
    if (err instanceof HttpError && err.status === 403) toast.error(err.title);
    else if (err instanceof HttpError) toast.error(err.title, { description: err.detail });
    else toast.error(fallback);
  }

  const isAdmin = currentUserRole === 'OWNER' || currentUserRole === 'ADMIN';
  const aiUsage = useAiUsage(workspaceSlug, { enabled: isAdmin });

  return (
    <section className="flex flex-col gap-3" aria-label={t('label')}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('heading')} <span className="ml-1 text-muted-foreground">({items.length})</span>
      </h4>
      <SummarizeThreadButton
        workspaceSlug={workspaceSlug}
        taskId={taskId}
        commentCount={items.length}
        usage={aiUsage.data}
        onPostAsComment={(summary) => {
          setDraft(`_(AI summary)_\n\n${summary}`);
        }}
      />
      {isLoading ? (
        <p className="text-xs text-muted-foreground">{t('loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((comment) => {
            const isAuthor = comment.authorUserId === currentUserId;
            const editable = canManage(currentUserRole, isAuthor);
            const inEdit = editing?.id === comment.id;
            return (
              <li key={comment.id} className="flex gap-2">
                <AssigneeBubble userId={comment.authorUserId} size="md" />
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {isAuthor ? t('authorSelf') : t('authorOther')}
                      {comment.editedAt ? (
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                          {t('edited')}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(comment.createdAt))}
                    </span>
                  </div>
                  {inEdit ? (
                    <div className="flex flex-col gap-1">
                      <MarkdownComposer
                        workspaceSlug={workspaceSlug}
                        value={editing.body}
                        onChange={(next) => setEditing({ id: comment.id, body: next })}
                        onSubmit={() => void commitEdit()}
                        submitLabel={t('save')}
                        isSubmitting={edit.isPending}
                        mentionMap={mentionMap}
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(null)}
                          className="h-6 px-2 text-[11px]"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                          {t('cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <SafeMarkdown source={comment.body} mentionMap={mentionMap} />
                      {comment.id.startsWith('optimistic-') ? null : (
                        <CommentReactions
                          workspaceSlug={workspaceSlug}
                          projectSlug={projectSlug}
                          taskNumber={taskNumber}
                          commentId={comment.id}
                          currentUserId={currentUserId}
                          currentUserDisplayName={currentUserDisplayName}
                        />
                      )}
                      {editable && !comment.id.startsWith('optimistic-') ? (
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setEditing({ id: comment.id, body: comment.body })}
                            aria-label={t('editAria')}
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                            {t('edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px] text-destructive"
                            onClick={() => remove.mutate({ id: comment.id })}
                            aria-label={t('deleteAria')}
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            {t('delete')}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <MarkdownComposer
        workspaceSlug={workspaceSlug}
        value={draft}
        onChange={setDraft}
        onSubmit={() => void commitNew()}
        isSubmitting={add.isPending}
        mentionMap={mentionMap}
      />
    </section>
  );
}
