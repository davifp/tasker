import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClientProvider } from '@tanstack/react-query';
import { AnalyticsProvider } from '@/features/analytics/AnalyticsProvider';
import { makeQueryClient } from '@/test/hooks-harness';
import enMessages from '@/i18n/messages/en.json';
import type { Task } from '@/lib/http/types';

let resolveTask: (task: Task) => void;

vi.mock('@/lib/http/tasks', () => ({
  tasksHttp: {
    findByNumber: vi.fn(
      () => new Promise<Task>((resolve) => { resolveTask = resolve; }),
    ),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/http/checklists', () => ({
  checklistsHttp: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/lib/http/dependencies', () => ({
  dependenciesHttp: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/lib/http/attachments', () => ({
  attachmentsHttp: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/lib/http/activity', () => ({
  activityHttp: { forTask: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

import { tasksHttp } from '@/lib/http/tasks';
import { checklistsHttp } from '@/lib/http/checklists';
import { dependenciesHttp } from '@/lib/http/dependencies';
import { attachmentsHttp } from '@/lib/http/attachments';
import { activityHttp } from '@/lib/http/activity';
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
    startDate: null,
    dueDate: null,
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderDrawer() {
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
            taskNumber={1}
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

describe('TaskDrawer — PERF-02', () => {
  it('fires sub-panel fetches in parallel with the root /tasks/:id fetch', async () => {
    renderDrawer();

    await waitFor(() => {
      expect(vi.mocked(tasksHttp.findByNumber)).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(vi.mocked(checklistsHttp.list)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(dependenciesHttp.list)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(attachmentsHttp.list)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(activityHttp.forTask)).toHaveBeenCalledTimes(1);
    });

    resolveTask(taskFactory());
  });
});
