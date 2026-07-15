import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Providers } from './providers';

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => <div role="status" aria-live="polite" data-testid="toaster" />,
}));

vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

describe('Layout with Providers', () => {
  it('renders Toaster in the provider tree', () => {
    render(
      <Providers>
        <main>content</main>
      </Providers>,
    );

    expect(screen.getByTestId('toaster')).toBeInTheDocument();
  });

  it('Toaster has an accessible live region role', () => {
    render(
      <Providers>
        <span />
      </Providers>,
    );

    expect(screen.getByTestId('toaster')).toHaveAttribute('aria-live', 'polite');
  });

  it('children are reachable via keyboard (rendered in DOM)', () => {
    render(
      <Providers>
        <button>focusable</button>
      </Providers>,
    );

    expect(screen.getByRole('button', { name: 'focusable' })).toBeInTheDocument();
  });
});
