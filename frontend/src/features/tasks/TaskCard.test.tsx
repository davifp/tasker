import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import enMessages from '@/i18n/messages/en.json';
import type { Task } from '@/lib/http/types';
import { TaskCard } from './TaskCard';

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    workspaceId: 'ws',
    projectId: 'p',
    number: 42,
    title: 'Wire the checklist badge',
    description: '',
    status: 'TODO',
    priority: 'MEDIUM',
    position: 'a0',
    assigneeUserId: null,
    createdByUserId: 'u-1',
    startDate: null,
    dueDate: null,
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-07-19T12:00:00Z',
    updatedAt: '2026-07-19T12:00:00Z',
    labels: [],
    ...overrides,
  };
}

function renderCard(task: Task) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DndContext>
        <SortableContext items={[task.id]}>
          <TaskCard task={task} onOpen={vi.fn()} />
        </SortableContext>
      </DndContext>
    </NextIntlClientProvider>,
  );
}

// Regression tests for BUG-08.H3 — PRD subtask 8.6 requires the
// checklist progress badge on the board card. Before the fix TaskCard
// rendered no reference to checklist at all.
describe('TaskCard — checklist progress badge (BUG-08.H3)', () => {
  it('renders the badge with done/total when the task has checklist items', () => {
    renderCard(baseTask({ checklistDone: 2, checklistTotal: 5 }));
    expect(screen.getByText('2/5')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/2 of 5 checklist items done/i),
    ).toBeInTheDocument();
  });

  it('renders 0/N when nothing is done yet', () => {
    renderCard(baseTask({ checklistDone: 0, checklistTotal: 3 }));
    expect(screen.getByText('0/3')).toBeInTheDocument();
  });

  it('omits the badge when the task has no checklist items', () => {
    renderCard(baseTask({ checklistDone: 0, checklistTotal: 0 }));
    expect(screen.queryByText(/checklist items done/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
  });

  it('omits the badge when the fields are undefined (older API responses)', () => {
    renderCard(baseTask({ checklistDone: undefined, checklistTotal: undefined }));
    expect(screen.queryByText(/checklist items done/i)).not.toBeInTheDocument();
  });
});
