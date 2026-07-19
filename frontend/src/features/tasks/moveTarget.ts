import type { Task, TaskStatus } from '@/lib/http/types';
import { Positions } from '@/lib/ordering/positions';

export interface DropTarget {
  status: TaskStatus;
  index: number;
}

export interface MoveComputation {
  status: TaskStatus;
  position: string;
  before: string | null;
  after: string | null;
}

// Given the current column snapshot and where the pointer landed, return
// the destination status + position key. Split out from `KanbanBoard` so
// the ordering math is unit-testable in isolation. Returns the neighbour
// positions so a 409 retry can recompute a fresh key between them.
export function computeMovePosition(
  activeTaskId: string,
  target: DropTarget,
  columnsByStatus: Record<TaskStatus, Task[]>,
): MoveComputation {
  const column = columnsByStatus[target.status] ?? [];
  const withoutActive = column.filter((task) => task.id !== activeTaskId);
  const boundedIndex = Math.max(0, Math.min(target.index, withoutActive.length));
  const before = boundedIndex > 0 ? (withoutActive[boundedIndex - 1]?.position ?? null) : null;
  const after =
    boundedIndex < withoutActive.length ? (withoutActive[boundedIndex]?.position ?? null) : null;
  const position = Positions.between(before, after);
  return { status: target.status, position, before, after };
}
