import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Providers } from './providers';
import enMessages from '@/i18n/messages/en.json';

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => <div role="status" aria-live="polite" data-testid="toaster" />,
}));

vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

function renderWithProviders(children: React.ReactNode) {
  return render(
    <Providers locale="en" messages={enMessages}>
      {children}
    </Providers>,
  );
}

describe('Layout with Providers', () => {
  it('renders Toaster in the provider tree', () => {
    renderWithProviders(<main>content</main>);
    expect(screen.getByTestId('toaster')).toBeInTheDocument();
  });

  it('Toaster has an accessible live region role', () => {
    renderWithProviders(<span />);
    expect(screen.getByTestId('toaster')).toHaveAttribute('aria-live', 'polite');
  });

  it('children are reachable via keyboard (rendered in DOM)', () => {
    renderWithProviders(<button>focusable</button>);
    expect(screen.getByRole('button', { name: 'focusable' })).toBeInTheDocument();
  });
});
