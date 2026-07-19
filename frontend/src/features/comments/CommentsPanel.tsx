'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import { useComments } from './hooks/useComments';
import { useAddComment, useDeleteComment, useEditComment } from './hooks/useCommentMutations';
import { useAnalytics } from '@/features/analytics/AnalyticsProvider';
import { Button } from '@/components/ui/button';
import { HttpError } from '@/lib/http/errors';
import { AssigneeBubble } from '@/features/tasks/AssigneeBubble';
import type { WorkspaceRole } from '@/lib/http/types';

interface CommentsPanelProps {
  workspaceSlug: string;
  workspaceId: string;
  projectId: string;
  projectSlug: string;
  taskNumber: number;
  taskId: string;
  currentUserId: string;
  currentUserRole: WorkspaceRole;
}

const MAX_LEN = 4000;

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

  async function commitNew() {
    const body = draft.trim();
    if (!body) return;
    try {
      const created = await add.mutateAsync({ body, authorUserId: currentUserId });
      emit({ name: 'comment_added', workspaceId, projectId, taskId, commentId: created.id });
      setDraft('');
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) toast.error(err.title);
      else if (err instanceof HttpError) toast.error(err.title, { description: err.detail });
      else toast.error(t('errors.addFailed'));
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
      if (err instanceof HttpError && err.status === 403) toast.error(err.title);
      else if (err instanceof HttpError) toast.error(err.title, { description: err.detail });
      else toast.error(t('errors.editFailed'));
    }
  }

  const items = data ?? [];

  return (
    <section className="flex flex-col gap-3" aria-label={t('label')}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('heading')} <span className="ml-1 text-muted-foreground">({items.length})</span>
      </h4>
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
                      <textarea
                        className="w-full rounded-md border border-border bg-background p-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        value={editing.body}
                        onChange={(event) =>
                          setEditing({ id: comment.id, body: event.target.value.slice(0, MAX_LEN) })
                        }
                        maxLength={MAX_LEN}
                        aria-label={t('editLabel')}
                      />
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(null)}
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                          {t('cancel')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void commitEdit()}
                          disabled={edit.isPending}
                        >
                          <Check className="h-3 w-3" aria-hidden="true" />
                          {t('save')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <p className="whitespace-pre-wrap text-sm text-foreground">{comment.body}</p>
                      {editable ? (
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
      <div className="flex flex-col gap-1">
        <textarea
          className="w-full rounded-md border border-border bg-background p-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, MAX_LEN))}
          placeholder={t('placeholder')}
          maxLength={MAX_LEN}
          aria-label={t('addLabel')}
          rows={3}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => void commitNew()}
            disabled={add.isPending || draft.trim().length === 0}
          >
            {add.isPending ? t('adding') : t('add')}
          </Button>
        </div>
      </div>
    </section>
  );
}
