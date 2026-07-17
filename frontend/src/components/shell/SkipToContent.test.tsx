import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkipToContent, MAIN_CONTENT_ID } from './SkipToContent';
import { renderWithIntl } from '@/test-utils/render-with-intl';

describe('SkipToContent', () => {
  it('renders a link that targets the main content anchor', () => {
    renderWithIntl(<SkipToContent />);
    const link = screen.getByRole('link', { name: /skip to main content/i });
    expect(link).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`);
  });

  it('receives focus on Tab from a cold page load', async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkipToContent />);

    await user.tab();

    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveFocus();
  });

  it('renders in Portuguese when the pt-BR locale is active', () => {
    renderWithIntl(<SkipToContent />, { locale: 'pt-BR' });
    expect(
      screen.getByRole('link', { name: /pular para o conteúdo principal/i }),
    ).toBeInTheDocument();
  });
});
