import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/i18n/messages/en.json';
import { CommandPalette } from './CommandPalette';
import { makeQueryClient } from '@/test/hooks-harness';
import { render } from '@testing-library/react';
import type * as UseSearchQueryModule from '@/features/search/useSearchQuery';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/features/search/useSearchQuery', async () => {
  const actual = await vi.importActual<typeof UseSearchQueryModule>(
    '@/features/search/useSearchQuery',
  );
  return {
    ...actual,
    useSearchQuery: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
    })),
  };
});

import * as useSearchQueryModule from '@/features/search/useSearchQuery';
const useSearchQueryMock = vi.mocked(useSearchQueryModule.useSearchQuery);

function renderPalette(props: React.ComponentProps<typeof CommandPalette>) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CommandPalette {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('CommandPalette', () => {
  it('opens when Cmd+K is pressed', async () => {
    const setOpen = vi.fn();
    renderPalette({ open: false, onOpenChange: setOpen });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(true));
  });

  it('opens when Ctrl+K is pressed', async () => {
    const setOpen = vi.fn();
    renderPalette({ open: false, onOpenChange: setOpen });
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(true));
  });

  it('renders the search input when open', () => {
    renderPalette({ open: true, onOpenChange: vi.fn(), workspaceSlug: 'ws' });
    expect(screen.getByLabelText(/search projects, tasks, and members/i)).toBeInTheDocument();
  });

  // BUG-02 regression — cmdk hard-sets aria-labelledby on the input; the
  // referenced <label cmdk-label> element must carry the placeholder text
  // so the input's accessible name is not empty. CommandDialog must pass
  // `label` down to the Command root. Radix Dialog renders into a portal,
  // so we query `document` (not the RTL container).
  it('resolves the combobox accessible name via cmdk-label (BUG-02 regression)', () => {
    renderPalette({ open: true, onOpenChange: vi.fn(), workspaceSlug: 'ws' });
    const cmdkLabel = document.querySelector('label[cmdk-label]');
    expect(cmdkLabel, '<label cmdk-label> must exist').not.toBeNull();
    expect(cmdkLabel!.textContent).toMatch(/search projects, tasks, and members/i);
    const combobox = screen.getByRole('combobox');
    const labelledById = combobox.getAttribute('aria-labelledby');
    expect(labelledById, 'combobox must be aria-labelledby').toBeTruthy();
    const labelledByEl = document.getElementById(labelledById!);
    expect(labelledByEl?.textContent, 'aria-labelledby target must not be empty').toMatch(
      /search projects, tasks, and members/i,
    );
  });

  // BUG-01 regression — cmdk's default shouldFilter=true would compare the
  // query against each item's `value` prop (type-id-label) and hide any hit
  // whose match sits only in the snippet (i.e. description/goal). Passing
  // shouldFilter={false} to CommandDialog trusts the server ranking.
  it('renders server hits whose label does not contain the query (BUG-01 regression)', async () => {
    useSearchQueryMock.mockReturnValue({
      data: {
        hits: [
          {
            type: 'task',
            id: 't1',
            label: 'Widget research thread',
            snippet: 'Investigate the <mark>grailmarker</mark> regression.',
            url: '/ws/projects/x/tasks/1',
            rank: 0.5,
            projectSlug: 'x',
            projectName: 'X',
            workspaceSlug: 'ws',
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
      isFetching: false,
      error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPalette({ open: true, onOpenChange: vi.fn(), workspaceSlug: 'ws' });
    // Type a query that does NOT appear in the label. Without shouldFilter=false
    // this assertion fails because cmdk hides the item client-side.
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'grailmarker' } });
    await waitFor(() => {
      expect(screen.getByText(/widget research thread/i)).toBeInTheDocument();
    });
    useSearchQueryMock.mockReset();
  });
});
