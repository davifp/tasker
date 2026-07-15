import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './theme-toggle';

const mockSetTheme = vi.fn();
let mockTheme = 'light';

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
}));

describe('ThemeToggle', () => {
  it('switches from light to dark on click', async () => {
    mockTheme = 'light';
    const user = userEvent.setup();

    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /switch to dark mode/i }));

    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('switches from dark to light on click', async () => {
    mockTheme = 'dark';
    const user = userEvent.setup();

    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /switch to light mode/i }));

    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });
});
