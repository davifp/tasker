import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/test/hooks-harness';
import enMessages from '@/i18n/messages/en.json';
import { AnalyticsProvider } from '@/features/analytics/AnalyticsProvider';
import type { CursorPage, Task, TaskStatus } from '@/lib/http/types';

// URL is the single source of truth for `useProjectFilters`; hook the
// router.replace assertion via the shared mock and mutate
// `mockSearchParams.current` to seed a filter state before mount.
const routerReplace = vi.fn();
const mockSearchParams = { current: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (...args: unknown[]) => routerReplace(...args),
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/ws/projects/p/backlog',
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
import { toast } from 'sonner';
import { Positions } from '@/lib/ordering/positions';
import { BacklogView } from './BacklogView';

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

function renderBacklog(tasks: Task[]) {
  const queryClient = makeQueryClient();
  vi.mocked(tasksHttp.list).mockResolvedValue({
    items: tasks,
    nextCursor: null,
  } satisfies CursorPage<Task>);
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryClientProvider client={queryClient}>
        <AnalyticsProvider>
          <BacklogView
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

describe('BacklogView — rendering', () => {
  it('renders one row per task, ordered ascending by position', async () => {
    // Deliberately pass out-of-order to prove the client sort kicks in.
    renderBacklog([
      taskFactory({ id: 't-c', number: 3, title: 'Third', position: 'a3' }),
      taskFactory({ id: 't-a', number: 1, title: 'First', position: 'a1' }),
      taskFactory({ id: 't-b', number: 2, title: 'Second', position: 'a2' }),
    ]);
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
    // Rows carry `data-task-number` in the order they render — the sort
    // asc-by-position guarantees numbers 1,2,3 in that order regardless
    // of the input ordering the fetcher returns.
    const list = screen.getByTestId('backlog-list');
    const numbers = Array.from(list.querySelectorAll('[data-task-number]')).map(
      (el) => el.getAttribute('data-task-number'),
    );
    expect(numbers).toEqual(['1', '2', '3']);
  });

  it('shows the skeleton while the first fetch is in flight', () => {
    const queryClient = makeQueryClient();
    vi.mocked(tasksHttp.list).mockReturnValue(new Promise(() => undefined));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryClientProvider client={queryClient}>
          <AnalyticsProvider>
            <BacklogView
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
    expect(screen.getByText('Loading backlog…')).toBeInTheDocument();
  });

  it('renders the empty state with clear-filters CTA when items = []', async () => {
    renderBacklog([]);
    await waitFor(() =>
      expect(screen.getByText('No tasks in this backlog')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('backlog-empty-clear')).toBeInTheDocument();
  });
});

describe('BacklogView — mutation payload', () => {
  it('sends the same payload from keyboard reorder that the equivalent drag would emit', async () => {
    // Two tasks, positions a1 and a2. Alt+ArrowDown on the first row
    // swaps it with the second; the target insert-index is 2, so
    // computeMovePosition asks for `between(a2, null)` → a3.
    vi.mocked(tasksHttp.move).mockResolvedValue({
      acknowledgedBlockersOpen: [],
    } as never);
    renderBacklog([
      taskFactory({ id: 't-a', number: 1, title: 'First', position: 'a1' }),
      taskFactory({ id: 't-b', number: 2, title: 'Second', position: 'a2' }),
    ]);
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());

    const user = userEvent.setup();
    const firstRow = screen.getByTestId('backlog-row-1');
    firstRow.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    // Byte-exact parity: `computeMovePosition` calls `Positions.between('a2', null)`
    // (the neighbour keys around the new tail slot), which returns `'a3'`
    // deterministically. A drag of row 1 below row 2 would compute the same
    // key from the same helper, so we assert on the exact payload.
    const expectedPosition = Positions.between('a2', null);
    await waitFor(() => {
      expect(tasksHttp.move).toHaveBeenCalledWith('ws', 'p', 1, {
        status: 'TODO',
        ifUnchangedSince: '2026-01-02T00:00:00.000Z',
        position: expectedPosition,
      });
    });
  });

  it('Alt+ArrowUp on the last row swaps it with the previous row', async () => {
    vi.mocked(tasksHttp.move).mockResolvedValue({
      acknowledgedBlockersOpen: [],
    } as never);
    renderBacklog([
      taskFactory({ id: 't-a', number: 1, title: 'First', position: 'a1' }),
      taskFactory({ id: 't-b', number: 2, title: 'Second', position: 'a2' }),
    ]);
    await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());

    const user = userEvent.setup();
    const secondRow = screen.getByTestId('backlog-row-2');
    secondRow.focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    await waitFor(() => {
      expect(tasksHttp.move).toHaveBeenCalledWith(
        'ws',
        'p',
        2,
        expect.objectContaining({
          status: 'TODO',
          // Inserted BEFORE `a1` — `between(null, a1)` produces a key < a1.
        }),
      );
    });
  });

  it('does not emit a move at edges (Alt+ArrowUp on first row is a no-op)', async () => {
    renderBacklog([
      taskFactory({ id: 't-a', number: 1, title: 'First', position: 'a1' }),
      taskFactory({ id: 't-b', number: 2, title: 'Second', position: 'a2' }),
    ]);
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());

    const user = userEvent.setup();
    const firstRow = screen.getByTestId('backlog-row-1');
    firstRow.focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    // Give the microtask queue a beat to flush; no move should fire.
    await act(async () => {
      await Promise.resolve();
    });
    expect(tasksHttp.move).not.toHaveBeenCalled();
  });
});

describe('BacklogView — error rollback + aria-live', () => {
  it('surfaces a toast + announce.moveFailed when the server rejects the move', async () => {
    vi.mocked(tasksHttp.move).mockRejectedValue(new Error('boom'));
    renderBacklog([
      taskFactory({ id: 't-a', number: 1, title: 'First', position: 'a1' }),
      taskFactory({ id: 't-b', number: 2, title: 'Second', position: 'a2' }),
    ]);
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());

    const user = userEvent.setup();
    const firstRow = screen.getByTestId('backlog-row-1');
    firstRow.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    // aria-live region carries the localized failure message.
    const live = document.querySelector('[aria-live="polite"][role="status"]');
    expect(live?.textContent).toMatch(/Could not move task First/i);
  });

  it('populates the aria-live region on successful keyboard reorder', async () => {
    vi.mocked(tasksHttp.move).mockResolvedValue({
      acknowledgedBlockersOpen: [],
    } as never);
    renderBacklog([
      taskFactory({ id: 't-a', number: 1, title: 'First', position: 'a1' }),
      taskFactory({ id: 't-b', number: 2, title: 'Second', position: 'a2' }),
    ]);
    await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());

    const user = userEvent.setup();
    const firstRow = screen.getByTestId('backlog-row-1');
    firstRow.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"][role="status"]');
      expect(live?.textContent).toMatch(/Moved "First"/);
    });
  });
});

describe('BacklogView — drawer', () => {
  it('opens the drawer when a row is clicked', async () => {
    vi.mocked(tasksHttp.findByNumber).mockResolvedValue(
      taskFactory({ id: 't-drawer', number: 42, title: 'Drawer target' }),
    );
    renderBacklog([
      taskFactory({ id: 't-drawer', number: 42, title: 'Drawer target' }),
    ]);
    await waitFor(() =>
      expect(screen.getByText('Drawer target')).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('backlog-row-42'));
    await waitFor(() => {
      expect(tasksHttp.findByNumber).toHaveBeenCalledWith('ws', 'p', 42);
    });
  });

  it('opens the drawer on Enter when the row is focused', async () => {
    vi.mocked(tasksHttp.findByNumber).mockResolvedValue(
      taskFactory({ id: 't-kb', number: 7, title: 'Kb target' }),
    );
    renderBacklog([taskFactory({ id: 't-kb', number: 7, title: 'Kb target' })]);
    await waitFor(() => expect(screen.getByText('Kb target')).toBeInTheDocument());

    const user = userEvent.setup();
    const row = screen.getByTestId('backlog-row-7');
    row.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(tasksHttp.findByNumber).toHaveBeenCalledWith('ws', 'p', 7);
    });
  });
});
