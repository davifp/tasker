import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import { renderWithIntl } from '@/test-utils/render-with-intl';

describe('CommandPalette', () => {
  it('opens when Cmd+K is pressed', async () => {
    const setOpen = vi.fn();
    renderWithIntl(<CommandPalette open={false} onOpenChange={setOpen} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(true));
  });

  it('opens when Ctrl+K is pressed', async () => {
    const setOpen = vi.fn();
    renderWithIntl(<CommandPalette open={false} onOpenChange={setOpen} />);
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
    await waitFor(() => expect(setOpen).toHaveBeenCalledWith(true));
  });

  it('shows the coming soon empty state when open', () => {
    renderWithIntl(<CommandPalette open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/search is coming soon/i)).toBeInTheDocument();
  });
});
