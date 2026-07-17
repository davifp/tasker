import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './theme-toggle';
import { renderWithIntl } from '@/test-utils/render-with-intl';

const mockSetTheme = vi.fn();
let mockTheme = 'light';

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
}));

describe('ThemeToggle', () => {
  it('switches from light to dark on click', async () => {
    mockTheme = 'light';
    const user = userEvent.setup();

    renderWithIntl(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /switch to dark mode/i }));

    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('switches from dark to light on click', async () => {
    mockTheme = 'dark';
    const user = userEvent.setup();

    renderWithIntl(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /switch to light mode/i }));

    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('uses translated aria-label in pt-BR', () => {
    mockTheme = 'light';
    renderWithIntl(<ThemeToggle />, { locale: 'pt-BR' });
    expect(screen.getByRole('button', { name: /modo escuro/i })).toBeInTheDocument();
  });
});
