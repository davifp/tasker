import { describe, it, expect } from 'vitest';
import type { Task, TaskStatus } from '@/lib/http/types';
import { computeMovePosition } from './moveTarget';

function task(id: string, position: string, status: TaskStatus = 'TODO'): Task {
  return {
    id,
    workspaceId: 'ws',
    projectId: 'p',
    number: Number(id.replace('t-', '')) || 0,
    title: id,
    description: '',
    status,
    priority: 'MEDIUM',
    position,
    assigneeUserId: null,
    createdByUserId: 'u',
    dueDate: null,
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const emptyBoard: Record<TaskStatus, Task[]> = {
  BACKLOG: [],
  TODO: [],
  IN_PROGRESS: [],
  IN_REVIEW: [],
  DONE: [],
};

describe('computeMovePosition', () => {
  it('appends to an empty target column', () => {
    const { position, before, after } = computeMovePosition(
      't-1',
      { status: 'DONE', index: 0 },
      emptyBoard,
    );
    expect(typeof position).toBe('string');
    expect(before).toBe(null);
    expect(after).toBe(null);
  });

  it('inserts between two existing tasks in a target column', () => {
    const board = {
      ...emptyBoard,
      TODO: [task('t-1', 'a0'), task('t-2', 'a4')],
    };
    const { position } = computeMovePosition(
      't-9',
      { status: 'TODO', index: 1 },
      board,
    );
    expect(position > 'a0').toBe(true);
    expect(position < 'a4').toBe(true);
  });

  it('excludes the active task from the target column when reordering inside it', () => {
    const board = {
      ...emptyBoard,
      TODO: [task('t-1', 'a0'), task('t-2', 'a4'), task('t-3', 'a8')],
    };
    // Move t-1 from index 0 down to the tail; withoutActive = [t-2, t-3]
    // index 2 → append after t-3
    const { position } = computeMovePosition(
      't-1',
      { status: 'TODO', index: 2 },
      board,
    );
    expect(position > 'a8').toBe(true);
  });
});
