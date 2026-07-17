import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Providers } from './providers';
import enMessages from '@/i18n/messages/en.json';
import ptBrMessages from '@/i18n/messages/pt-BR.json';

function QueryClientInspector() {
  const client = useQueryClient();
  return <div data-testid="qc-present">{client ? 'yes' : 'no'}</div>;
}

function LocaleInspector() {
  const locale = useLocale();
  const t = useTranslations('common.themeToggle');
  return (
    <>
      <span data-testid="locale">{locale}</span>
      <span data-testid="translated">{t('label')}</span>
    </>
  );
}

describe('Providers', () => {
  it('renders children', () => {
    render(
      <Providers locale="en" messages={enMessages}>
        <span data-testid="child">hello</span>
      </Providers>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('mounts a QueryClient accessible to children', () => {
    render(
      <Providers locale="en" messages={enMessages}>
        <QueryClientInspector />
      </Providers>,
    );

    expect(screen.getByTestId('qc-present')).toHaveTextContent('yes');
  });

  it('propagates the active locale and messages to client components', () => {
    render(
      <Providers locale="pt-BR" messages={ptBrMessages}>
        <LocaleInspector />
      </Providers>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('pt-BR');
    expect(screen.getByTestId('translated')).toHaveTextContent('Alternar tema');
  });
});
