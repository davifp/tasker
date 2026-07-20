'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { HttpError } from '@/lib/http/errors';
import type { Task, TaskLabel, WorkspaceRole } from '@/lib/http/types';
import { useProjectTasks } from '../hooks/useProjectTasks';
import { useMoveTask } from '../hooks/useMoveTask';
import { useProjectFilters, toTaskFilters } from '../useProjectFilters';
import { computeMovePosition } from '../moveTarget';
import { PriorityChip } from '../PriorityChip';
import { DueDatePill } from '../DueDatePill';
import { AssigneeBubble } from '../AssigneeBubble';
import { TaskDrawer } from '../TaskDrawer';

interface BacklogViewProps {
  workspaceSlug: string;
  workspaceId: string;
  projectSlug: string;
  projectId: string;
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  initialTaskNumber?: number;
}

function labelChipStyle(color: string): React.CSSProperties {
  return { backgroundColor: `${color}22`, color };
}

function LabelChips({ labels }: { labels: TaskLabel[] | undefined }) {
  if (!labels || labels.length === 0) return null;
  const shown = labels.slice(0, 2);
  const overflow = labels.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium"
          style={labelChipStyle(label.color)}
          title={label.name}
        >
          {label.name}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          aria-label={`+${overflow}`}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

interface BacklogRowProps {
  task: Task;
  index: number;
  total: number;
  onOpen: (taskNumber: number) => void;
  onKeyboardMove: (task: Task, direction: -1 | 1) => void;
}

// Sortable row — activates dnd via a dedicated grab handle button so the
// row itself stays a plain focusable region for click / Enter / Alt-arrow
// reorder. Matches Kanban's `TaskCard` model where the drag handle is the
// only element carrying `attributes` + `listeners`.
function BacklogRow({ task, index, total, onOpen, onKeyboardMove }: BacklogRowProps) {
  const t = useTranslations('backlog');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { type: 'task', task } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  function handleRowKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      onKeyboardMove(task, -1);
      return;
    }
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      onKeyboardMove(task, 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(task.number);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'list-none rounded-md border border-border bg-background shadow-sm transition-shadow hover:shadow-md',
        isDragging && 'ring-2 ring-ring',
      )}
      data-task-id={task.id}
      data-task-number={task.number}
      data-index={index}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={t('rowLabel', {
          number: task.number,
          title: task.title,
          index: index + 1,
          total,
        })}
        className="flex w-full items-center gap-3 rounded-md p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpen(task.number)}
        onKeyDown={handleRowKey}
        data-testid={`backlog-row-${task.number}`}
      >
        {/* Drag handle — the only surface carrying dnd-kit listeners so
            ordinary clicks/Enter on the row body never race with drag
            activation. */}
        <button
          type="button"
          className="flex h-8 w-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('openRow', { number: task.number, title: task.title })}
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            // Space is dnd-kit's keyboard drag activator; let it through.
            if (event.key === 'Enter') event.stopPropagation();
          }}
          data-testid={`backlog-drag-${task.number}`}
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
        <span className="flex-1 truncate text-sm font-medium text-foreground">
          {task.title}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <PriorityChip priority={task.priority} />
          <AssigneeBubble userId={task.assigneeUserId} />
          {task.dueDate ? <DueDatePill dueDate={task.dueDate} /> : null}
          <LabelChips labels={task.labels} />
          <span className="w-10 text-right text-[10px] font-medium text-muted-foreground">
            #{task.number}
          </span>
        </span>
      </div>
    </li>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  const t = useTranslations('backlog.empty');
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-10 text-center"
      role="status"
    >
      <p className="text-sm font-medium text-foreground">{t('title')}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t('body')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClear}
        data-testid="backlog-empty-clear"
      >
        {t('clear')}
      </Button>
    </div>
  );
}

function BacklogSkeleton() {
  const t = useTranslations('backlog');
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

function compareByPosition<T extends { position: string }>(a: T, b: T): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/**
 * Backlog view — single vertical list of tasks ordered ascending by
 * `position`. Reorder is drag-driven via `@dnd-kit/core` (same sensors as
 * Kanban) and keyboard-driven via `Alt+ArrowUp` / `Alt+ArrowDown` on the
 * focused row. Both paths route through the same `POST /tasks/:number/move`
 * mutation (`useMoveTask`) so drag + keyboard produce identical payloads.
 *
 * Design decisions:
 * - Sort: purely presentation-only, applied client-side in the `rows`
 *   `useMemo` via `compareByPosition`. The view sends the SAME filter set
 *   Kanban and List send (no injected `sort=position`), so all three
 *   views hit the same TanStack Query cache entry — switching Kanban →
 *   Backlog for the same filters produces zero extra network requests,
 *   honoring the PRD invariant.
 * - The URL `sort` param is intentionally NOT respected here. Backlog's
 *   identity IS "prioritized list ordered by `position`" — visiting
 *   `/backlog?sort=updatedAt` still renders in position order because
 *   that's the view's contract.
 * - Position math: reuses `computeMovePosition` — MATCHING Kanban's
 *   client-side convention. Backend still validates and can regenerate
 *   under a 409 retry (see `useMoveTask`).
 * - Move hook: reuses `useMoveTask` unchanged. The backend `MoveTaskDto`
 *   requires `status`, so backlog moves send the task's own status
 *   (no-op status change, new position). No `useMoveBacklogTask` needed.
 */
export function BacklogView({
  workspaceSlug,
  workspaceId,
  projectSlug,
  projectId,
  currentUserId,
  currentUserRole,
  initialTaskNumber,
}: BacklogViewProps) {
  const t = useTranslations('backlog');
  const projectFilters = useProjectFilters();
  const { filters, clear } = projectFilters;

  // Pass the SAME filter shape Kanban/List pass — no `sort=position`
  // augmentation — so all three views share one TanStack Query cache
  // entry per filter set. Ordering is enforced client-side in the `rows`
  // useMemo below; that's the view's identity, not a wire concern.
  const listFilters = useMemo(
    () => toTaskFilters(filters, currentUserId),
    [filters, currentUserId],
  );

  const { data, isLoading, isError } = useProjectTasks(
    workspaceSlug,
    projectSlug,
    listFilters,
    { limit: 100 },
  );

  const move = useMoveTask(workspaceSlug, projectSlug);

  const [openTaskNumber, setOpenTaskNumber] = useState<number | null>(
    initialTaskNumber ?? null,
  );
  const [liveMessage, setLiveMessage] = useState<string>('');

  useEffect(() => {
    if (initialTaskNumber !== undefined) setOpenTaskNumber(initialTaskNumber);
  }, [initialTaskNumber]);

  // Enforce ascending-by-`position` client-side. The shared cache entry
  // is whatever ordering the URL asked for (or backend default); this
  // re-sort is what makes Backlog "Backlog" and what drag/kb math
  // relies on being stable.
  const rows: Task[] = useMemo(() => {
    const items = data?.items ?? [];
    return [...items].sort(compareByPosition);
  }, [data?.items]);

  const rowIds = useMemo(() => rows.map((task) => task.id), [rows]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Emit a single move request. Shared by drag-end and keyboard reorder
  // so both paths hit the same mutation with the same payload shape.
  const submitMove = useCallback(
    async (source: Task, targetIndex: number) => {
      // Fake a "single column" bucket keyed by the task's own status so
      // `computeMovePosition` returns neighbour positions relative to the
      // full backlog. Backlog moves preserve `status`; the server treats
      // the payload as a same-status, new-position move.
      const columnsByStatus = { [source.status]: rows } as Parameters<
        typeof computeMovePosition
      >[2];
      const { position, before, after } = computeMovePosition(
        source.id,
        { status: source.status, index: targetIndex },
        columnsByStatus,
      );
      try {
        await move.mutateAsync({
          number: source.number,
          status: source.status,
          position,
          ifUnchangedSince: source.updatedAt,
          targetBefore: before,
          targetAfter: after,
          targetStatus: source.status,
        });
        const currentIndex = rows.findIndex((task) => task.id === source.id);
        const newIndex =
          targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
        setLiveMessage(
          t('announce.moved', {
            title: source.title,
            index: newIndex + 1,
            total: rows.length,
          }),
        );
      } catch (err) {
        setLiveMessage(t('announce.moveFailed', { title: source.title }));
        if (err instanceof HttpError) {
          toast.error(err.title, { description: err.detail });
        } else {
          toast.error(t('errors.moveFailed'));
        }
      }
    },
    [move, rows, t],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      if (!event.over) return;
      const overId = String(event.over.id);
      if (activeId === overId) return;
      const source = rows.find((task) => task.id === activeId);
      if (!source) return;
      const overIndex = rows.findIndex((task) => task.id === overId);
      if (overIndex < 0) return;
      const currentIndex = rows.findIndex((task) => task.id === activeId);
      // dnd-kit gives us the row we dropped ONTO. Translate to the
      // "insert-before" index that `computeMovePosition` expects: when
      // moving downward, target lands after the over row.
      const targetIndex = currentIndex < overIndex ? overIndex + 1 : overIndex;
      if (targetIndex === currentIndex || targetIndex === currentIndex + 1) return;
      await submitMove(source, targetIndex);
    },
    [rows, submitMove],
  );

  const handleKeyboardMove = useCallback(
    async (source: Task, direction: -1 | 1) => {
      const currentIndex = rows.findIndex((task) => task.id === source.id);
      if (currentIndex < 0) return;
      const swapWith = currentIndex + direction;
      if (swapWith < 0 || swapWith >= rows.length) return;
      // Translate a "swap with neighbour" into the insert-before index
      // `computeMovePosition` consumes: moving down means "insert after
      // neighbour" i.e. neighbour's index + 1; moving up means "insert
      // before neighbour" i.e. neighbour's index.
      const targetIndex = direction === 1 ? swapWith + 1 : swapWith;
      await submitMove(source, targetIndex);
    },
    [rows, submitMove],
  );

  const handleOpen = useCallback((taskNumber: number) => {
    setOpenTaskNumber(taskNumber);
  }, []);

  if (isLoading && rows.length === 0) {
    return <BacklogSkeleton />;
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        {t('errorLoad')}
      </div>
    );
  }

  const isEmpty = rows.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite" role="status" className="sr-only">
        {liveMessage}
      </div>
      <p className="sr-only" id="backlog-reorder-instructions">
        {t('reorderInstructions')}
      </p>
      {isEmpty ? (
        <EmptyState onClear={clear} />
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
            <ul
              className="flex flex-col gap-2"
              data-testid="backlog-list"
              aria-describedby="backlog-reorder-instructions"
              aria-label={t('caption')}
            >
              {rows.map((task, index) => (
                <BacklogRow
                  key={task.id}
                  task={task}
                  index={index}
                  total={rows.length}
                  onOpen={handleOpen}
                  onKeyboardMove={handleKeyboardMove}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
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
        onDelete={() => setOpenTaskNumber(null)}
      />
    </div>
  );
}
