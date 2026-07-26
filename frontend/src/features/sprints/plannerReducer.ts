/**
 * Pure reducer for the two-pane Backlog↔Sprint planner. Kept out of the
 * component so it can be unit-tested without React Testing Library, and so
 * the optimistic move + revert flow is provable in isolation.
 */

export interface PlannerTask {
  id: string;
  number: number;
  title: string;
  estimate: number | null;
  assigneeUserId: string | null;
}

export interface PlannerState {
  backlog: PlannerTask[];
  sprint: PlannerTask[];
}

export type PlannerAction =
  | { type: 'moveToSprint'; taskIds: string[] }
  | { type: 'moveToBacklog'; taskIds: string[] }
  | { type: 'reset'; next: PlannerState };

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'moveToSprint': {
      const moving = state.backlog.filter((t) => action.taskIds.includes(t.id));
      if (moving.length === 0) return state;
      return {
        backlog: state.backlog.filter((t) => !action.taskIds.includes(t.id)),
        sprint: [...state.sprint, ...moving],
      };
    }
    case 'moveToBacklog': {
      const moving = state.sprint.filter((t) => action.taskIds.includes(t.id));
      if (moving.length === 0) return state;
      return {
        backlog: [...state.backlog, ...moving],
        sprint: state.sprint.filter((t) => !action.taskIds.includes(t.id)),
      };
    }
    case 'reset':
      return action.next;
    default:
      return state;
  }
}

/**
 * Sums per-task estimates in points. Null estimates contribute 0 (per PRD
 * FR-18 semantics; nulls still count for scope but not for velocity).
 */
export function sumEstimates(tasks: PlannerTask[]): number {
  return tasks.reduce((acc, t) => acc + (t.estimate ?? 0), 0);
}

/**
 * Groups estimated load per assignee. Used by the capacity drawer to
 * flag over-allocation.
 */
export function loadPerAssignee(tasks: PlannerTask[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const t of tasks) {
    if (!t.assigneeUserId) continue;
    totals.set(t.assigneeUserId, (totals.get(t.assigneeUserId) ?? 0) + (t.estimate ?? 0));
  }
  return totals;
}
