import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { LocaleSwitcher } from './LocaleSwitcher';
import { renderWithIntl } from '@/test-utils/render-with-intl';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it('renders a trigger labeled with the language switcher affordance', () => {
    renderWithIntl(<LocaleSwitcher />, { locale: 'en' });
    expect(screen.getByRole('button', { name: /language/i })).toBeInTheDocument();
  });

  it('renders the localized affordance in pt-BR', () => {
    renderWithIntl(<LocaleSwitcher />, { locale: 'pt-BR' });
    expect(screen.getByRole('button', { name: /idioma/i })).toBeInTheDocument();
  });
});
