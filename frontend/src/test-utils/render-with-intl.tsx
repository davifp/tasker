import type { ReactElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { render, type RenderOptions } from '@testing-library/react';
import enMessages from '@/i18n/messages/en.json';
import ptBrMessages from '@/i18n/messages/pt-BR.json';
import type { Locale } from '@/i18n/config';

const messagesByLocale = {
  en: enMessages,
  'pt-BR': ptBrMessages,
} as const;

export interface RenderWithIntlOptions extends Omit<RenderOptions, 'wrapper'> {
  locale?: Locale;
}

export function renderWithIntl(ui: ReactElement, options: RenderWithIntlOptions = {}) {
  const { locale = 'en', ...rest } = options;
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale={locale} messages={messagesByLocale[locale]}>
        {children}
      </NextIntlClientProvider>
    ),
    ...rest,
  });
}
