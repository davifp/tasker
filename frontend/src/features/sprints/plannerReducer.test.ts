import { describe, it, expect } from 'vitest';
import {
  loadPerAssignee,
  plannerReducer,
  sumEstimates,
  type PlannerState,
  type PlannerTask,
} from './plannerReducer';

const t = (id: string, extras: Partial<PlannerTask> = {}): PlannerTask => ({
  id,
  number: Number(id.replace('t-', '')) || 0,
  title: `Task ${id}`,
  estimate: 3,
  assigneeUserId: 'u-1',
  ...extras,
});

const state = (): PlannerState => ({
  backlog: [t('t-1'), t('t-2', { estimate: 5, assigneeUserId: 'u-2' })],
  sprint: [t('t-3', { estimate: 2 })],
});

describe('plannerReducer', () => {
  it('moves selected backlog tasks into the sprint pane', () => {
    const next = plannerReducer(state(), { type: 'moveToSprint', taskIds: ['t-1'] });
    expect(next.backlog.map((x) => x.id)).toEqual(['t-2']);
    expect(next.sprint.map((x) => x.id)).toEqual(['t-3', 't-1']);
  });

  it('moves selected sprint tasks back to the backlog', () => {
    const next = plannerReducer(state(), { type: 'moveToBacklog', taskIds: ['t-3'] });
    expect(next.sprint).toHaveLength(0);
    expect(next.backlog.map((x) => x.id)).toEqual(['t-1', 't-2', 't-3']);
  });

  it('is a no-op when the task ids do not intersect the source pane', () => {
    const next = plannerReducer(state(), { type: 'moveToSprint', taskIds: ['t-999'] });
    expect(next).toEqual(state());
  });

  it('reset replaces the entire state (used by the revert-on-error path)', () => {
    const initial = state();
    const other: PlannerState = { backlog: [], sprint: [t('t-9')] };
    const next = plannerReducer(initial, { type: 'reset', next: other });
    expect(next).toEqual(other);
  });
});

describe('sumEstimates', () => {
  it('sums integer estimates; null contributes 0', () => {
    expect(
      sumEstimates([
        t('t-1', { estimate: 3 }),
        t('t-2', { estimate: null }),
        t('t-3', { estimate: 5 }),
      ]),
    ).toBe(8);
  });

  it('is 0 for empty input', () => {
    expect(sumEstimates([])).toBe(0);
  });
});

describe('loadPerAssignee', () => {
  it('groups estimates by assignee and ignores unassigned', () => {
    const loads = loadPerAssignee([
      t('t-1', { estimate: 3, assigneeUserId: 'u-1' }),
      t('t-2', { estimate: 5, assigneeUserId: 'u-2' }),
      t('t-3', { estimate: 2, assigneeUserId: 'u-1' }),
      t('t-4', { estimate: 4, assigneeUserId: null }),
    ]);
    expect(loads.get('u-1')).toBe(5);
    expect(loads.get('u-2')).toBe(5);
    expect(loads.has(String(null))).toBe(false);
  });
});
