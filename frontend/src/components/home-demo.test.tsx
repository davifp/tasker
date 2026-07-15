import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeDemo } from './home-demo';

const mockToastSuccess = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => mockToastSuccess(...args) },
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button aria-label="Toggle theme" />,
}));

describe('HomeDemo', () => {
  it('renders the Trigger Toast button', () => {
    render(<HomeDemo />);

    expect(screen.getByRole('button', { name: 'Trigger Toast' })).toBeInTheDocument();
  });

  it('calls toast.success when the button is clicked', async () => {
    const user = userEvent.setup();
    render(<HomeDemo />);

    await user.click(screen.getByRole('button', { name: 'Trigger Toast' }));

    expect(mockToastSuccess).toHaveBeenCalledOnce();
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Toast triggered!',
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it('renders the theme toggle', () => {
    render(<HomeDemo />);

    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument();
  });
});
