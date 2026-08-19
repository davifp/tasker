'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTask } from './hooks/useTasks';
import { useUpdateTask } from './hooks/useUpdateTask';
import { toastFromError } from '@/lib/errors/toastFromError';
import type { Task, WorkspaceRole } from '@/lib/http/types';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { TaskMetadataPanel } from './TaskMetadataPanel';
import { ChecklistPanel } from '@/features/checklists/ChecklistPanel';
import { useAddChecklistItem } from '@/features/checklists/hooks/useChecklistMutations';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { DependenciesPanel } from '@/features/dependencies/DependenciesPanel';
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel';
import { ActivityFeed } from '@/features/activity/ActivityFeed';
import { AiActionsMenu } from '@/features/ai/components/AiActionsMenu';
import { useAiUsage, useAcceptAiConsent } from '@/features/ai/hooks/useAiUsage';
import { useWorkspaceRole } from '@/features/workspace/context/WorkspaceRoleContext';

interface TaskDrawerProps {
  workspaceSlug: string;
  workspaceId: string;
  projectSlug: string;
  projectId: string;
  taskNumber: number | null;
  currentUserId?: string;
  currentUserRole?: WorkspaceRole;
  onClose: () => void;
  onDelete: (task: Task) => void;
  // Focus the title textarea on first mount. Set true for deep-link entry
  // (per PRD user story); false for regular card clicks so the caret does
  // not land in an editable field the user did not ask to edit.
  focusTitleOnMount?: boolean;
}

// Right-side slide-in drawer. Open/close state lives in the parent
// KanbanBoard so a `taskNumber` prop toggles the Sheet. Radix already
// handles focus trap on open + return-focus on close; we deliberately
// do NOT retain focus after the last field so Tab keeps the natural
// document flow (spec calls out "focus never trapped").
export function TaskDrawer({
  workspaceSlug,
  workspaceId,
  projectSlug,
  projectId,
  taskNumber,
  currentUserId,
  currentUserRole,
  onClose,
  onDelete,
  focusTitleOnMount = false,
}: TaskDrawerProps) {
  const t = useTranslations('board.drawer');
  const open = taskNumber !== null;
  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent
        side="right"
        className="w-full max-w-lg overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Prevent Radix from stealing focus to the close button. The
          // drawer body picks up focus in the first render pass instead.
          event.preventDefault();
        }}
      >
        {taskNumber !== null ? (
          <DrawerBody
            key={taskNumber}
            workspaceSlug={workspaceSlug}
            workspaceId={workspaceId}
            projectSlug={projectSlug}
            projectId={projectId}
            taskNumber={taskNumber}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            onDelete={onDelete}
            focusTitleOnMount={focusTitleOnMount}
          />
        ) : (
          <SheetHeader>
            <SheetTitle className="sr-only">{t('title')}</SheetTitle>
            <SheetDescription className="sr-only">{t('description')}</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface DrawerBodyProps {
  workspaceSlug: string;
  workspaceId: string;
  projectSlug: string;
  projectId: string;
  taskNumber: number;
  currentUserId?: string;
  currentUserRole?: WorkspaceRole;
  onDelete: (task: Task) => void;
  focusTitleOnMount: boolean;
}

function DrawerBody({
  workspaceSlug,
  workspaceId,
  projectSlug,
  projectId,
  taskNumber,
  currentUserId,
  currentUserRole,
  onDelete,
  focusTitleOnMount,
}: DrawerBodyProps) {
  const t = useTranslations('board.drawer');
  const { data: task, isLoading } = useTask(workspaceSlug, projectSlug, taskNumber);
  const update = useUpdateTask(workspaceSlug, projectSlug);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const focusedOnce = useRef(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const isAdmin = currentUserRole === 'OWNER' || currentUserRole === 'ADMIN';
  const { canWrite } = useWorkspaceRole();
  // Only admins can hit /ai/usage — the endpoint returns 403 otherwise.
  // The menu still renders for members; the banner + disabled state read
  // from the admin-populated usage cache when available, else fall back
  // to the disabled "Admin must enable AI" state.
  const usageQuery = useAiUsage(workspaceSlug, { enabled: isAdmin });
  const acceptConsent = useAcceptAiConsent(workspaceSlug, usageQuery.data?.consent.requiredDocumentVersion ?? 'v1');
  const addChecklistItem = useAddChecklistItem({ workspaceSlug, projectSlug, taskNumber });

  useEffect(() => {
    // Focus the title textarea exactly once — but only when the deep-link
    // user story asks for it (per PRD). Regular card clicks leave focus on
    // Radix's default (post-onOpenAutoFocus this is the SheetContent root)
    // so the caret does not land in an editable field the user did not
    // explicitly choose to edit.
    if (task && !focusedOnce.current && focusTitleOnMount) {
      focusedOnce.current = true;
      titleRef.current?.focus();
    }
  }, [task, focusTitleOnMount]);

  async function commitTitle() {
    if (!task) return;
    const next = (titleDraft ?? task.title).trim();
    setTitleDraft(null);
    if (!next || next === task.title) return;
    try {
      await update.mutateAsync({ number: task.number, patch: { title: next } });
    } catch (err) {
      toastFromError(err, t('errors.saveTitleFailed'));
    }
  }

  async function commitDescription() {
    if (!task) return;
    try {
      await update.mutateAsync({ number: task.number, patch: { description: descDraft } });
      setEditingDescription(false);
    } catch (err) {
      toastFromError(err, t('errors.saveDescriptionFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isLoading || !task ? (
        <div className="flex flex-col gap-3">
          <SheetHeader>
            <SheetTitle>{t('loading')}</SheetTitle>
            <SheetDescription className="sr-only">{t('description')}</SheetDescription>
          </SheetHeader>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          <SheetHeader className="gap-2">
            <SheetDescription className="text-xs font-mono uppercase text-muted-foreground">
              {t('taskNumber', { number: task.number })}
            </SheetDescription>
            <SheetTitle asChild>
              <textarea
                ref={titleRef}
                rows={1}
                className="resize-none rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold text-foreground hover:border-border focus:border-border focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:hover:border-transparent"
                value={titleDraft ?? task.title}
                readOnly={!canWrite}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void commitTitle()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    (event.target as HTMLTextAreaElement).blur();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setTitleDraft(null);
                    (event.target as HTMLTextAreaElement).blur();
                  }
                }}
                aria-label={t('titleLabel')}
              />
            </SheetTitle>
          </SheetHeader>

          <TaskMetadataPanel
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            task={task}
          />

          <AiActionsMenu
            workspaceSlug={workspaceSlug}
            taskId={task.id}
            taskTitle={task.title}
            usage={usageQuery.data}
            isAdmin={isAdmin}
            onAcceptConsent={isAdmin ? () => acceptConsent.mutate() : undefined}
            onAcceptDescription={async (draft) => {
              // Persist immediately so follow-up AI actions (checklist,
              // estimate) that read the description from the DB see the new
              // value. The editor stays open so the user can still tweak-
              // and-resave.
              setDescDraft(draft);
              setEditingDescription(true);
              try {
                await update.mutateAsync({ number: task.number, patch: { description: draft } });
              } catch (err) {
                toastFromError(err, t('errors.saveDescriptionFailed'));
              }
            }}
            onAcceptChecklist={async (items) => {
              // Persist items sequentially so their positions match the order the
              // model produced (the API assigns position at insert time). Parallel
              // fires would race on position and shuffle the list.
              let failed = 0;
              for (const title of items) {
                try {
                  await addChecklistItem.mutateAsync({ title });
                } catch {
                  failed += 1;
                }
              }
              if (failed === 0) {
                toast.success(`Added ${items.length} checklist item${items.length === 1 ? '' : 's'}.`);
              } else if (failed < items.length) {
                toast.warning(
                  `Added ${items.length - failed} of ${items.length} items — ${failed} failed.`,
                );
              } else {
                toast.error('Could not add any checklist items.');
              }
            }}
          />

          <section className="flex flex-col gap-2" aria-label={t('descriptionLabel')}>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('descriptionHeading')}
              </h4>
              {!editingDescription && canWrite ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => {
                    setDescDraft(task.description ?? '');
                    setEditingDescription(true);
                  }}
                >
                  {t('edit')}
                </Button>
              ) : null}
            </div>
            {editingDescription ? (
              <MarkdownEditor
                value={descDraft}
                onChange={setDescDraft}
                onSave={() => void commitDescription()}
                onCancel={() => setEditingDescription(false)}
                saving={update.isPending}
              />
            ) : task.description ? (
              <MarkdownPreview markdown={task.description} />
            ) : (
              <p className="text-xs text-muted-foreground">{t('noDescription')}</p>
            )}
          </section>
        </>
      )}

      <ChecklistPanel
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        taskNumber={taskNumber}
      />

      <DependenciesPanel
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        taskNumber={taskNumber}
      />

      {currentUserId && currentUserRole ? (
        <>
          {task ? (
            <CommentsPanel
              workspaceSlug={workspaceSlug}
              workspaceId={workspaceId}
              projectId={projectId}
              projectSlug={projectSlug}
              taskNumber={taskNumber}
              taskId={task.id}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
            />
          ) : null}
          <AttachmentsPanel
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            taskNumber={taskNumber}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
          />
          <ActivityFeed
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            taskNumber={taskNumber}
          />
        </>
      ) : null}

      {task && canWrite ? (
        <footer className="mt-2 flex justify-end border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => onDelete(task)}
          >
            <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('delete')}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
