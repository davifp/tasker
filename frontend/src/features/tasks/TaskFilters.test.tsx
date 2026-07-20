import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/test/hooks-harness';
import enMessages from '@/i18n/messages/en.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/ws/projects/p/board',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/features/labels/hooks/useLabels', () => ({
  useLabels: () => ({
    data: {
      items: [
        { id: 'lbl-urgent', name: 'urgent', color: '#ef4444' },
        { id: 'lbl-chore', name: 'chore', color: '#64748b' },
      ],
    },
  }),
}));

vi.mock('@/features/members/hooks/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => ({
    data: [
      { userId: 'user-alice', displayName: 'Alice', email: 'a@x.com', role: 'ADMIN' },
      { userId: 'user-bob', displayName: 'Bob', email: 'b@x.com', role: 'MEMBER' },
    ],
  }),
}));

import { TaskFilters } from './TaskFilters';
import { makeEmptyFilters, type UseProjectFiltersResult } from './useProjectFilters';

function makeHookState(
  overrides: Partial<UseProjectFiltersResult> = {},
): UseProjectFiltersResult {
  return {
    filters: makeEmptyFilters(),
    setView: vi.fn(),
    setAssignee: vi.fn(),
    setLabels: vi.fn(),
    toggleLabel: vi.fn(),
    setStatus: vi.fn(),
    setPriority: vi.fn(),
    setDateRange: vi.fn(),
    setSort: vi.fn(),
    clear: vi.fn(),
    isEmpty: true,
    ...overrides,
  };
}

function renderFilters(hookOverride: UseProjectFiltersResult) {
  const queryClient = makeQueryClient();
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <QueryClientProvider client={queryClient}>
        <TaskFilters
          workspaceSlug="ws"
          currentUserId="user-me"
          hookOverride={hookOverride}
        />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('TaskFilters', () => {
  it('renders both dropdown triggers and no chips when filters are empty', () => {
    renderFilters(makeHookState());
    expect(screen.getByRole('button', { name: 'Filter by assignee' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter by labels' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('calls setAssignee with "me" when the "Assigned to me" item is selected', async () => {
    const state = makeHookState();
    renderFilters(state);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filter by assignee' }));
    await user.click(await screen.findByRole('menuitem', { name: /Assigned to me/ }));
    expect(state.setAssignee).toHaveBeenCalledWith('me');
  });

  it('calls toggleLabel with the label id when a label is chosen', async () => {
    const state = makeHookState();
    renderFilters(state);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Filter by labels' }));
    await user.click(await screen.findByRole('menuitem', { name: /urgent/ }));
    expect(state.toggleLabel).toHaveBeenCalledWith('lbl-urgent');
  });

  it('renders chips + a clear-all button when a filter is active', async () => {
    const state = makeHookState({
      filters: { ...makeEmptyFilters(), assignee: 'me', labels: ['lbl-urgent'] },
      isEmpty: false,
    });
    renderFilters(state);
    // Chip for the assignee
    expect(screen.getByRole('button', { name: 'Clear assignee filter' })).toBeInTheDocument();
    // Chip for the label
    expect(
      screen.getByRole('button', { name: 'Remove urgent filter' }),
    ).toBeInTheDocument();
    // Clear-all
    const clearAll = screen.getByRole('button', { name: 'Clear filters' });
    expect(clearAll).toBeInTheDocument();
    await userEvent.setup().click(clearAll);
    expect(state.clear).toHaveBeenCalled();
  });

  it('shows the current user\'s member displayName when the assignee is another user', async () => {
    const state = makeHookState({
      filters: { ...makeEmptyFilters(), assignee: { userId: 'user-alice' } },
      isEmpty: false,
    });
    renderFilters(state);
    // Trigger shows Alice's name
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Filter by assignee' })).toHaveTextContent(
        'Alice',
      ),
    );
  });
});
