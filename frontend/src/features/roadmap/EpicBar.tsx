'use client';

import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { Epic } from '@/lib/http/epics';
import { quarterOrdinal } from './quarter-range';

const STATUS_COLORS: Record<Epic['status'], string> = {
  PLANNED: 'bg-blue-500/10 border-blue-500 text-blue-700 dark:text-blue-300',
  IN_PROGRESS: 'bg-amber-500/10 border-amber-500 text-amber-700 dark:text-amber-300',
  DONE: 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-300',
  CANCELED: 'bg-muted border-border text-muted-foreground line-through',
};

export interface EpicBarProps {
  epic: Epic;
  gridStart: string;
  readOnly: boolean;
  onEdit: (epic: Epic) => void;
}

/**
 * A single epic bar rendered inside the roadmap grid. Column start / span
 * are computed from the epic's `startQuarter`/`endQuarter` relative to the
 * grid's `gridStart` so the CSS grid `grid-column` shorthand can position
 * the bar without JS layout work.
 *
 * Draggable via dnd-kit `useDraggable`. The parent `RoadmapBoard` handles
 * the drop event and translates it into a `PATCH /epics/:id` mutation
 * targeting the new `startQuarter`. Resize handles are deferred — the
 * dialog editor covers span edits in the interim.
 */
export function EpicBar({ epic, gridStart, readOnly, onEdit }: EpicBarProps): React.JSX.Element {
  const colStart = quarterOrdinal(epic.startQuarter) - quarterOrdinal(gridStart) + 1;
  const colSpan = quarterOrdinal(epic.endQuarter) - quarterOrdinal(epic.startQuarter) + 1;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: epic.id,
    disabled: readOnly,
    data: { startQuarter: epic.startQuarter, endQuarter: epic.endQuarter },
  });

  const style: React.CSSProperties = {
    gridColumn: `${colStart} / span ${colSpan}`,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onEdit(epic)}
      aria-label={`Epic ${epic.title} from ${epic.startQuarter} to ${epic.endQuarter}, status ${epic.status}`}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-left text-xs shadow-sm',
        STATUS_COLORS[epic.status],
        readOnly ? 'cursor-default' : 'cursor-grab hover:brightness-105',
      )}
      data-testid={`epic-bar-${epic.id}`}
    >
      <span className="truncate font-medium">{epic.title}</span>
      <span className="ml-auto text-[10px] uppercase tracking-wide opacity-70">{epic.status}</span>
    </button>
  );
}
