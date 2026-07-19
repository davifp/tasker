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
import { HttpError } from '@/lib/http/errors';
import type { Task, WorkspaceRole } from '@/lib/http/types';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { TaskMetadataPanel } from './TaskMetadataPanel';
import { ChecklistPanel } from '@/features/checklists/ChecklistPanel';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { DependenciesPanel } from '@/features/dependencies/DependenciesPanel';

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

  if (isLoading || !task) {
    return (
      <div className="flex flex-col gap-3">
        <SheetHeader>
          <SheetTitle>{t('loading')}</SheetTitle>
          <SheetDescription className="sr-only">{t('description')}</SheetDescription>
        </SheetHeader>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  async function commitTitle() {
    const next = (titleDraft ?? task!.title).trim();
    setTitleDraft(null);
    if (!next || next === task!.title) return;
    try {
      await update.mutateAsync({ number: task!.number, patch: { title: next } });
    } catch (err) {
      if (err instanceof HttpError) toast.error(err.title, { description: err.detail });
      else toast.error(t('errors.saveTitleFailed'));
    }
  }

  async function commitDescription() {
    try {
      await update.mutateAsync({ number: task!.number, patch: { description: descDraft } });
      setEditingDescription(false);
    } catch (err) {
      if (err instanceof HttpError) toast.error(err.title, { description: err.detail });
      else toast.error(t('errors.saveDescriptionFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SheetHeader className="gap-2">
        <SheetDescription className="text-xs font-mono uppercase text-muted-foreground">
          {t('taskNumber', { number: task.number })}
        </SheetDescription>
        <SheetTitle asChild>
          <textarea
            ref={titleRef}
            rows={1}
            className="resize-none rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold text-foreground hover:border-border focus:border-border focus:outline-none focus:ring-2 focus:ring-ring"
            value={titleDraft ?? task.title}
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

      <section className="flex flex-col gap-2" aria-label={t('descriptionLabel')}>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('descriptionHeading')}
          </h4>
          {!editingDescription ? (
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

      <ChecklistPanel
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        taskNumber={task.number}
      />

      <DependenciesPanel
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        taskNumber={task.number}
      />

      {currentUserId && currentUserRole ? (
        <CommentsPanel
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
          projectId={projectId}
          projectSlug={projectSlug}
          taskNumber={task.number}
          taskId={task.id}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
        />
      ) : null}

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
    </div>
  );
}
