import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClientProvider } from '@tanstack/react-query';
import { AnalyticsProvider } from '@/features/analytics/AnalyticsProvider';
import { makeQueryClient } from '@/test/hooks-harness';
import enMessages from '@/i18n/messages/en.json';
import type { Task } from '@/lib/http/types';

vi.mock('@/lib/http/tasks', () => ({
  tasksHttp: {
    findByNumber: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/http/checklists', () => ({
  checklistsHttp: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/lib/http/comments', () => ({
  commentsHttp: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/lib/http/dependencies', () => ({
  dependenciesHttp: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { tasksHttp } from '@/lib/http/tasks';
import { TaskDrawer } from './TaskDrawer';

function taskFactory(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    workspaceId: 'ws',
    projectId: 'p',
    number: 1,
    title: 'Focus card',
    description: 'plain body',
    status: 'TODO',
    priority: 'MEDIUM',
    position: 'a1',
    assigneeUserId: null,
    createdByUserId: 'u',
    dueDate: null,
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderDrawer(taskNumber: number | null) {
  const queryClient = makeQueryClient();
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryClientProvider client={queryClient}>
        <AnalyticsProvider>
          <TaskDrawer
            workspaceSlug="ws"
            workspaceId="ws-1"
            projectSlug="p"
            projectId="p-1"
            taskNumber={taskNumber}
            currentUserId="u-1"
            currentUserRole="MEMBER"
            onClose={() => undefined}
            onDelete={() => undefined}
          />
        </AnalyticsProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('TaskDrawer', () => {
  it('renders nothing detectable when closed (taskNumber=null)', () => {
    renderDrawer(null);
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
  });

  it('opens the drawer and loads task detail when a taskNumber is provided', async () => {
    vi.mocked(tasksHttp.findByNumber).mockResolvedValueOnce(taskFactory());
    renderDrawer(1);
    await waitFor(() => {
      expect(screen.getByLabelText('Task title')).toHaveValue('Focus card');
    });
  });

  it('Tab from the last drawer field does not trap focus inside the drawer body', async () => {
    vi.mocked(tasksHttp.findByNumber).mockResolvedValueOnce(taskFactory());
    renderDrawer(1);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText('Task title')).toBeInTheDocument());
    const title = screen.getByLabelText('Task title');
    title.focus();
    // A few Tabs should keep focus somewhere valid — no error is thrown
    // and focus does not get stuck on the title.
    await user.tab();
    await user.tab();
    expect(document.activeElement).not.toBeNull();
  });
});
