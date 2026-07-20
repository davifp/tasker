'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useProjectTasks } from './hooks/useProjectTasks';
import { useCreateTask } from './hooks/useCreateTask';
import { useMoveTask, BlockersOpenError } from './hooks/useMoveTask';
import { useDeleteTaskWithUndo } from './hooks/useDeleteTaskWithUndo';
import { useAnalytics } from '@/features/analytics/AnalyticsProvider';
import { HttpError } from '@/lib/http/errors';
import type { Task, TaskStatus, WorkspaceRole } from '@/lib/http/types';
import { COLUMN_ORDER } from './columnOrder';
import { computeMovePosition, type DropTarget } from './moveTarget';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { BlockerOverrideDialog, type BlockerOverrideState } from './BlockerOverrideDialog';
import { TaskDrawer } from './TaskDrawer';
import { boardDndAnnouncements } from './dndAnnouncements';
import { TaskFilters } from './TaskFilters';
import { useProjectFilters, toTaskFilters } from './useProjectFilters';

interface KanbanBoardProps {
  workspaceSlug: string;
  workspaceId: string;
  projectSlug: string;
  projectId: string;
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  // Deep-link entry: when set, the drawer opens on mount focused on the
  // title textarea (per PRD deep-link user story).
  initialTaskNumber?: number;
}

interface PendingMove {
  task: Task;
  fromStatus: TaskStatus;
  targetStatus: TaskStatus;
  position: string;
  before: string | null;
  after: string | null;
  ifUnchangedSince: string;
}

function compareByPosition<T extends { position: string }>(a: T, b: T): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const buckets = COLUMN_ORDER.reduce(
    (acc, status) => {
      acc[status] = [];
      return acc;
    },
    {} as Record<TaskStatus, Task[]>,
  );
  for (const task of tasks) {
    if (COLUMN_ORDER.includes(task.status)) buckets[task.status].push(task);
  }
  for (const status of COLUMN_ORDER) {
    buckets[status].sort(compareByPosition);
  }
  return buckets;
}

// Central board client component: fetches tasks once, groups them,
// exposes the DnD surface, and coordinates optimistic mutation results
// with the drawer, blocker override dialog, and undo-delete toast.
export function KanbanBoard({
  workspaceSlug,
  workspaceId,
  projectSlug,
  projectId,
  currentUserId,
  currentUserRole,
  initialTaskNumber,
}: KanbanBoardProps) {
  const t = useTranslations('board');
  const projectFilters = useProjectFilters();
  const taskFilters = useMemo(
    () => toTaskFilters(projectFilters.filters, currentUserId),
    [projectFilters.filters, currentUserId],
  );
  const { data, isLoading, isError } = useProjectTasks(
    workspaceSlug,
    projectSlug,
    taskFilters,
    { limit: 100 },
  );
  const emit = useAnalytics();

  const create = useCreateTask(workspaceSlug, projectSlug);
  const move = useMoveTask(workspaceSlug, projectSlug);
  const del = useDeleteTaskWithUndo(workspaceSlug, projectSlug);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTaskNumber, setOpenTaskNumber] = useState<number | null>(initialTaskNumber ?? null);
  const [blockerState, setBlockerState] = useState<BlockerOverrideState | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [liveMessage, setLiveMessage] = useState<string>('');

  // If the deep-link prop changes (client navigation to another task URL
  // without a full remount), reflect the new target so the drawer follows.
  useEffect(() => {
    if (initialTaskNumber !== undefined) setOpenTaskNumber(initialTaskNumber);
  }, [initialTaskNumber]);

  const columnsByStatus = useMemo(() => groupByStatus(data?.items ?? []), [data?.items]);
  const activeTask = useMemo(() => {
    if (!activeId) return null;
    for (const status of COLUMN_ORDER) {
      const found = columnsByStatus[status].find((task) => task.id === activeId);
      if (found) return found;
    }
    return null;
  }, [activeId, columnsByStatus]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const announcements = useMemo(
    () =>
      boardDndAnnouncements({
        onDragStart: (id) => t('dnd.pickedUp', { id }),
        onDragOver: (id, over) => t('dnd.movedOver', { id, over }),
        onDragEnd: (id, over) => t('dnd.dropped', { id, over }),
        onDragCancel: (id) => t('dnd.cancelled', { id }),
      }),
    [t],
  );

  const runMove = useCallback(
    async (moveInput: PendingMove, overrideBlockers: boolean): Promise<void> => {
      try {
        await move.mutateAsync({
          number: moveInput.task.number,
          status: moveInput.targetStatus,
          position: moveInput.position,
          ifUnchangedSince: moveInput.ifUnchangedSince,
          overrideBlockers,
          targetBefore: moveInput.before,
          targetAfter: moveInput.after,
          targetStatus: moveInput.targetStatus,
        });
        emit({
          name: 'task_moved',
          workspaceId,
          projectId,
          taskId: moveInput.task.id,
          fromStatus: moveInput.fromStatus,
          toStatus: moveInput.targetStatus,
        });
        if (moveInput.targetStatus === 'DONE' && moveInput.fromStatus !== 'DONE') {
          emit({
            name: 'task_completed',
            workspaceId,
            projectId,
            taskId: moveInput.task.id,
          });
        }
        setLiveMessage(
          t('announce.moved', {
            title: moveInput.task.title,
            column: t(`columns.${moveInput.targetStatus}`),
          }),
        );
      } catch (err) {
        if (err instanceof BlockersOpenError) {
          // Rollback fired via onError inside useMoveTask. Open the dialog
          // and stash the pending move so the confirm path can re-invoke.
          setBlockerState({
            taskNumber: moveInput.task.number,
            taskTitle: moveInput.task.title,
            blockers: err.blockers,
          });
          setPendingMove(moveInput);
          return;
        }
        setLiveMessage(t('announce.moveFailed', { title: moveInput.task.title }));
        if (err instanceof HttpError) {
          toast.error(err.title, { description: err.detail });
        } else {
          toast.error(t('errors.moveFailed'));
        }
      }
    },
    [emit, move, projectId, t, workspaceId],
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function findDropTarget(overId: string, activeTaskId: string): DropTarget | null {
    if (overId.startsWith('column:')) {
      const status = overId.slice('column:'.length) as TaskStatus;
      if (!COLUMN_ORDER.includes(status)) return null;
      const column = columnsByStatus[status] ?? [];
      const withoutActive = column.filter((task) => task.id !== activeTaskId);
      return { status, index: withoutActive.length };
    }
    for (const status of COLUMN_ORDER) {
      const idx = columnsByStatus[status].findIndex((task) => task.id === overId);
      if (idx >= 0) return { status, index: idx };
    }
    return null;
  }

  async function handleDragEnd(event: DragEndEvent) {
    const activeIdStr = String(event.active.id);
    setActiveId(null);
    if (!event.over) return;
    const target = findDropTarget(String(event.over.id), activeIdStr);
    if (!target) return;
    const source = activeTask;
    if (!source) return;
    if (target.status === source.status) {
      const columnIndex = columnsByStatus[source.status].findIndex((task) => task.id === source.id);
      // Dropping onto the source slot or one below (which resolves to the
      // same visual position once the source is removed from the column)
      // is a no-op.
      if (columnIndex === target.index || columnIndex + 1 === target.index) return;
    }
    const { position, before, after } = computeMovePosition(source.id, target, columnsByStatus);
    await runMove(
      {
        task: source,
        fromStatus: source.status,
        targetStatus: target.status,
        position,
        before,
        after,
        ifUnchangedSince: source.updatedAt,
      },
      false,
    );
  }

  async function handleQuickAdd(title: string, status: TaskStatus) {
    try {
      const created = await create.mutateAsync({ title, status });
      emit({ name: 'task_created', workspaceId, projectId, taskId: created.id });
      toast.success(t('quickAdd.created', { title: created.title }));
    } catch (err) {
      if (err instanceof HttpError) {
        toast.error(err.title, { description: err.detail });
      } else {
        toast.error(t('errors.createFailed'));
      }
    }
  }

  async function handleDelete(task: Task) {
    try {
      const result = await del.mutate({ number: task.number });
      toast(t('undo.deleted', { title: task.title }), {
        duration: 30000,
        action: {
          label: t('undo.action'),
          onClick: () => {
            void result.undo();
          },
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        toast.error(err.title, { description: err.detail });
      } else {
        toast.error(t('errors.deleteFailed'));
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex gap-3" role="status" aria-live="polite">
        <span className="sr-only">{t('loading')}</span>
        {COLUMN_ORDER.map((status) => (
          <div
            key={status}
            className="h-64 min-w-[280px] flex-1 animate-pulse rounded-lg bg-muted"
          />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {t('errors.loadFailed')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite" role="status" className="sr-only">
        {liveMessage}
      </div>
      <TaskFilters workspaceSlug={workspaceSlug} currentUserId={currentUserId} />
      <DndContext
        sensors={sensors}
        accessibility={{ announcements }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMN_ORDER.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={columnsByStatus[status]}
              quickAddDisabled={create.isPending}
              onOpenTask={(taskNumber) => setOpenTaskNumber(taskNumber)}
              onQuickAdd={handleQuickAdd}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>
          {activeTask ? (
            <ul className="w-[280px]">
              <TaskCard task={activeTask} onOpen={() => undefined} />
            </ul>
          ) : null}
        </DragOverlay>
        {activeTask ? (
          <div
            className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-lg"
            role="status"
          >
            {t('dnd.dragModeHint')}
          </div>
        ) : null}
      </DndContext>
      <BlockerOverrideDialog
        state={blockerState}
        onCancel={() => {
          setBlockerState(null);
          setPendingMove(null);
        }}
        onConfirm={() => {
          const pending = pendingMove;
          setBlockerState(null);
          setPendingMove(null);
          if (pending) void runMove(pending, true);
        }}
      />
      <TaskDrawer
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        projectSlug={projectSlug}
        projectId={projectId}
        taskNumber={openTaskNumber}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        focusTitleOnMount={initialTaskNumber !== undefined}
        onClose={() => setOpenTaskNumber(null)}
        onDelete={(task) => {
          setOpenTaskNumber(null);
          void handleDelete(task);
        }}
      />
    </div>
  );
}
