import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/test/hooks-harness';
import enMessages from '@/i18n/messages/en.json';
import { AnalyticsProvider } from '@/features/analytics/AnalyticsProvider';
import type { CursorPage, Task, TaskStatus } from '@/lib/http/types';

// URL is the single source of truth for `useProjectFilters`, so the test
// hooks the router.replace assertion via the shared mock. Each test can
// mutate `mockSearchParams.current` to seed a filter state before mount.
const routerReplace = vi.fn();
const mockSearchParams = { current: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (...args: unknown[]) => routerReplace(...args),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/ws/projects/p/list',
  useSearchParams: () => new URLSearchParams(mockSearchParams.current),
}));

vi.mock('@/features/members/hooks/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => ({ data: [] }),
}));

vi.mock('@/features/labels/hooks/useLabels', () => ({
  useLabels: () => ({ data: { items: [] } }),
}));

vi.mock('@/lib/http/tasks', () => ({
  tasksHttp: {
    list: vi.fn(),
    findByNumber: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
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
import { ListView } from './ListView';

function taskFactory(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-1',
    workspaceId: 'ws',
    projectId: 'p',
    number: 1,
    title: 'Ship it',
    description: '',
    status: 'TODO' as TaskStatus,
    priority: 'MEDIUM',
    position: 'a1',
    assigneeUserId: null,
    createdByUserId: 'u',
    startDate: null,
    dueDate: null,
    deletedAt: null,
    purgeAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    labels: [],
    ...overrides,
  };
}

function renderList(tasks: Task[]) {
  const queryClient = makeQueryClient();
  vi.mocked(tasksHttp.list).mockResolvedValue({
    items: tasks,
    nextCursor: null,
  } satisfies CursorPage<Task>);
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryClientProvider client={queryClient}>
        <AnalyticsProvider>
          <ListView
            workspaceSlug="ws"
            workspaceId="ws-1"
            projectSlug="p"
            projectId="p-1"
            currentUserId="u-1"
            currentUserRole="MEMBER"
          />
        </AnalyticsProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.current = '';
});

describe('ListView — rendering', () => {
  it('renders a row per task with the seven default column headers', async () => {
    renderList([
      taskFactory({ id: 't-1', number: 1, title: 'First task' }),
      taskFactory({ id: 't-2', number: 2, title: 'Second task', status: 'DONE' }),
    ]);
    await waitFor(() =>
      expect(screen.getByText('First task')).toBeInTheDocument(),
    );
    for (const label of ['Title', 'Status', 'Assignee', 'Priority', 'Due date', 'Labels', 'Updated']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByText('Second task')).toBeInTheDocument();
  });

  it('shows the skeleton while the first fetch is in flight', () => {
    const queryClient = makeQueryClient();
    vi.mocked(tasksHttp.list).mockReturnValue(new Promise(() => undefined));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryClientProvider client={queryClient}>
          <AnalyticsProvider>
            <ListView
              workspaceSlug="ws"
              workspaceId="ws-1"
              projectSlug="p"
              projectId="p-1"
              currentUserId="u-1"
              currentUserRole="MEMBER"
            />
          </AnalyticsProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Loading tasks…')).toBeInTheDocument();
  });

  it('renders the empty state with a clear-filters CTA when items is empty', async () => {
    renderList([]);
    await waitFor(() =>
      expect(screen.getByText('No tasks match your filters')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('list-empty-clear')).toBeInTheDocument();
  });
});

describe('ListView — sorting', () => {
  it('cycles the sort for a sortable header asc → desc → clear', async () => {
    // Fresh mount (no sort). First click → asc.
    renderList([taskFactory()]);
    await waitFor(() =>
      expect(screen.getByText('Ship it')).toBeInTheDocument(),
    );
    const user = userEvent.setup();
    const dueHeader = screen
      .getByRole('columnheader', { name: /due date/i })
      .querySelector('button') as HTMLButtonElement;
    routerReplace.mockClear();
    await user.click(dueHeader);
    let url = routerReplace.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain('sort=dueDate');
    expect(url).toContain('sortDir=asc');

    // Second click on the same column (URL seeded with asc) → desc.
    cleanup();
    mockSearchParams.current = 'sort=dueDate&sortDir=asc';
    renderList([taskFactory()]);
    await waitFor(() =>
      expect(screen.getByText('Ship it')).toBeInTheDocument(),
    );
    const dueHeader2 = screen
      .getByRole('columnheader', { name: /due date/i })
      .querySelector('button') as HTMLButtonElement;
    routerReplace.mockClear();
    await user.click(dueHeader2);
    url = routerReplace.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain('sort=dueDate');
    expect(url).toContain('sortDir=desc');

    // Third click on the same column (URL seeded with desc) → clears.
    cleanup();
    mockSearchParams.current = 'sort=dueDate&sortDir=desc';
    renderList([taskFactory()]);
    await waitFor(() =>
      expect(screen.getByText('Ship it')).toBeInTheDocument(),
    );
    const dueHeader3 = screen
      .getByRole('columnheader', { name: /due date/i })
      .querySelector('button') as HTMLButtonElement;
    routerReplace.mockClear();
    await user.click(dueHeader3);
    url = routerReplace.mock.calls.at(-1)?.[0] as string;
    expect(url).not.toContain('sort=');
    expect(url).not.toContain('sortDir=');
  });

  it('sets aria-sort on the sorted column header', async () => {
    mockSearchParams.current = 'sort=priority&sortDir=asc';
    renderList([taskFactory()]);
    await waitFor(() =>
      expect(screen.getByText('Ship it')).toBeInTheDocument(),
    );
    const priorityHeader = screen.getByRole('columnheader', {
      name: /priority/i,
    });
    expect(priorityHeader.getAttribute('aria-sort')).toBe('ascending');
    const dueHeader = screen.getByRole('columnheader', { name: /due date/i });
    expect(dueHeader.getAttribute('aria-sort')).toBe('none');
  });

  it('does not render a sort button for non-sortable columns (assignee, labels)', async () => {
    renderList([taskFactory()]);
    await waitFor(() =>
      expect(screen.getByText('Ship it')).toBeInTheDocument(),
    );
    const assigneeHeader = screen.getByRole('columnheader', { name: /assignee/i });
    const labelsHeader = screen.getByRole('columnheader', { name: /labels/i });
    expect(assigneeHeader.querySelector('button')).toBeNull();
    expect(labelsHeader.querySelector('button')).toBeNull();
  });

  it('activates sorting via keyboard Enter on a header button', async () => {
    renderList([taskFactory()]);
    await waitFor(() =>
      expect(screen.getByText('Ship it')).toBeInTheDocument(),
    );
    const user = userEvent.setup();
    const titleButton = screen
      .getByRole('columnheader', { name: /title/i })
      .querySelector('button') as HTMLButtonElement;
    titleButton.focus();
    routerReplace.mockClear();
    await user.keyboard('{Enter}');
    const url = routerReplace.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain('sort=title');
    expect(url).toContain('sortDir=asc');
  });
});

describe('ListView — density toggle', () => {
  it('flips the table data-density attribute between compact and comfortable', async () => {
    renderList([taskFactory()]);
    await waitFor(() =>
      expect(screen.getByText('Ship it')).toBeInTheDocument(),
    );
    const table = screen.getByTestId('list-table');
    expect(table.getAttribute('data-density')).toBe('compact');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('list-density-toggle'));
    expect(table.getAttribute('data-density')).toBe('comfortable');
  });
});

describe('ListView — column picker', () => {
  it('hides a column when its checkbox is unchecked', async () => {
    renderList([
      taskFactory({
        labels: [{ id: 'l-1', name: 'urgent', color: '#ef4444' }],
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByText('urgent')).toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('list-column-picker-trigger'));
    const toggleLabels = await screen.findByRole('checkbox', {
      name: /toggle labels/i,
    });
    await user.click(toggleLabels);
    // Header for `Labels` should disappear; the urgent chip inside the
    // hidden cell should be gone too.
    await waitFor(() =>
      expect(
        screen.queryByRole('columnheader', { name: /labels/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('urgent')).not.toBeInTheDocument();
  });

  it('reorders columns via the up/down buttons', async () => {
    renderList([taskFactory()]);
    await waitFor(() =>
      expect(screen.getByText('Ship it')).toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('list-column-picker-trigger'));
    // Move `Due date` up twice — starts at index 4, so ends up at index
    // 2 (i.e. before `Assignee`, which puts it visibly ahead of
    // `Priority` in the header row).
    await user.click(
      await screen.findByRole('button', { name: /move due date up/i }),
    );
    await user.click(
      screen.getByRole('button', { name: /move due date up/i }),
    );
    // Close the picker so Radix's focus-scope releases inert on the
    // page content; without it `getAllByRole('columnheader')` skips
    // hidden elements and returns nothing.
    await user.keyboard('{Escape}');
    await waitFor(() => {
      const headers = screen
        .getAllByRole('columnheader')
        .map((el) => el.textContent?.trim() ?? '');
      const dueIndex = headers.findIndex((h) => /due date/i.test(h));
      const priorityIndex = headers.findIndex((h) => /priority/i.test(h));
      expect(dueIndex).toBeGreaterThan(-1);
      expect(priorityIndex).toBeGreaterThan(-1);
      expect(dueIndex).toBeLessThan(priorityIndex);
    });
  });
});

describe('ListView — drawer', () => {
  it('opens the drawer when a row is clicked', async () => {
    vi.mocked(tasksHttp.findByNumber).mockResolvedValue(
      taskFactory({ id: 't-drawer', number: 42, title: 'Drawer target' }),
    );
    renderList([taskFactory({ id: 't-drawer', number: 42, title: 'Drawer target' })]);
    await waitFor(() =>
      expect(screen.getByText('Drawer target')).toBeInTheDocument(),
    );
    const user = userEvent.setup();
    const rowInBody = within(
      screen.getByTestId('list-table').querySelector('tbody') as HTMLElement,
    ).getByRole('row');
    await user.click(rowInBody);
    await waitFor(() => {
      expect(tasksHttp.findByNumber).toHaveBeenCalledWith('ws', 'p', 42);
    });
  });

  it('opens the drawer on Enter when the row is focused', async () => {
    vi.mocked(tasksHttp.findByNumber).mockResolvedValue(
      taskFactory({ id: 't-kb', number: 7, title: 'Kb target' }),
    );
    renderList([taskFactory({ id: 't-kb', number: 7, title: 'Kb target' })]);
    await waitFor(() => expect(screen.getByText('Kb target')).toBeInTheDocument());
    const user = userEvent.setup();
    const rowInBody = within(
      screen.getByTestId('list-table').querySelector('tbody') as HTMLElement,
    ).getByRole('row');
    rowInBody.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(tasksHttp.findByNumber).toHaveBeenCalledWith('ws', 'p', 7);
    });
  });
});
