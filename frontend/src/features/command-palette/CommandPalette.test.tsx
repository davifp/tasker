import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/i18n/messages/en.json';
import { CommandPalette } from './CommandPalette';
import { makeQueryClient } from '@/test/hooks-harness';
import { render } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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
});
