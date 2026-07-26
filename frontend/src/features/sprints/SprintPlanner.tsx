'use client';

import { useCallback, useMemo, useReducer, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
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
import { AlertCircle, Users2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { HttpError } from '@/lib/http/errors';
import { useSprintMoveTask } from './useSprintMoveTask';
import {
  plannerReducer,
  sumEstimates,
  type PlannerState,
  type PlannerTask,
} from './plannerReducer';

export interface SprintPlannerProps {
  workspaceSlug: string;
  projectSlug: string;
  sprintNumber: number;
  initialBacklog: PlannerTask[];
  initialSprint: PlannerTask[];
}

type PaneId = 'backlog' | 'sprint';

const PANES: readonly PaneId[] = ['backlog', 'sprint'];

export function SprintPlanner({
  workspaceSlug,
  projectSlug,
  sprintNumber,
  initialBacklog,
  initialSprint,
}: SprintPlannerProps): React.JSX.Element {
  const [state, dispatch] = useReducer(plannerReducer, {
    backlog: initialBacklog,
    sprint: initialSprint,
  } satisfies PlannerState);

  const moveMutation = useSprintMoveTask({ workspaceSlug, projectSlug, sprintNumber });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findPane = useCallback(
    (taskId: string): PaneId | null => {
      if (state.backlog.some((t) => t.id === taskId)) return 'backlog';
      if (state.sprint.some((t) => t.id === taskId)) return 'sprint';
      return null;
    },
    [state],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over?.id ? String(event.over.id) : null;
      if (!overId) return;

      const from = findPane(activeId);
      const to = PANES.includes(overId as PaneId) ? (overId as PaneId) : findPane(overId);
      if (!from || !to || from === to) return;

      const before = state;
      const taskIds: string[] = [activeId];
      dispatch(
        to === 'sprint' ? { type: 'moveToSprint', taskIds } : { type: 'moveToBacklog', taskIds },
      );

      moveMutation.mutate(
        to === 'sprint' ? { add: [activeId], remove: [] } : { add: [], remove: [activeId] },
        {
          onError: (err) => {
            dispatch({ type: 'reset', next: before });
            const message =
              err instanceof HttpError
                ? (err.detail ?? err.title ?? err.message)
                : 'Move failed. Please try again.';
            toast.error(message);
          },
        },
      );
    },
    [state, findPane, moveMutation],
  );

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid gap-4 lg:grid-cols-2">
        <PlannerPane
          id="backlog"
          title="Backlog"
          tasks={state.backlog}
          testId="sprint-planner-backlog"
        />
        <PlannerPane
          id="sprint"
          title={`Sprint ${sprintNumber}`}
          tasks={state.sprint}
          testId="sprint-planner-sprint"
        />
      </div>
    </DndContext>
  );
}

interface PlannerPaneProps {
  id: PaneId;
  title: string;
  tasks: PlannerTask[];
  testId: string;
}

function PlannerPane({ id, title, tasks, testId }: PlannerPaneProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id });
  const total = useMemo(() => sumEstimates(tasks), [tasks]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col rounded-lg border border-border bg-card p-4',
        isOver && 'ring-2 ring-primary',
      )}
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-counts`}>
          {tasks.length} task{tasks.length === 1 ? '' : 's'} · {total} pts
        </p>
      </header>
      <div ref={setNodeRef} className="min-h-40 flex-1" data-testid={testId}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <p className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground">
              Drop tasks here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tasks.map((task) => (
                <SortableTaskItem
                  key={task.id}
                  task={task}
                  selected={selectedId === task.id}
                  onSelect={() => setSelectedId(task.id === selectedId ? null : task.id)}
                />
              ))}
            </ul>
          )}
        </SortableContext>
      </div>
    </section>
  );
}

interface SortableTaskItemProps {
  task: PlannerTask;
  selected: boolean;
  onSelect: () => void;
}

function SortableTaskItem({ task, selected, onSelect }: SortableTaskItemProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      className={cn(
        'flex cursor-grab items-start gap-2 rounded border border-border bg-background p-2 text-xs shadow-sm',
        selected && 'ring-1 ring-primary',
      )}
      data-testid={`sprint-planner-task-${task.id}`}
    >
      <span className="font-mono text-[10px] uppercase text-muted-foreground">#{task.number}</span>
      <span className="flex-1 text-foreground">{task.title}</span>
      {task.estimate === null ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground" title="No estimate">
          <AlertCircle className="h-3 w-3" aria-hidden />
          <span className="sr-only">No estimate</span>
        </span>
      ) : (
        <span className="text-muted-foreground">{task.estimate} pts</span>
      )}
      {task.assigneeUserId ? (
        <span className="inline-flex items-center text-muted-foreground" title="Assigned">
          <Users2 className="h-3 w-3" aria-hidden />
        </span>
      ) : null}
    </li>
  );
}
