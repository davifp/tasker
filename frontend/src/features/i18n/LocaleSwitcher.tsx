'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Check, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { locales, localeCookieName, type Locale } from '@/i18n/config';

const LABELS: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (BR)',
};

export function LocaleSwitcher() {
  const t = useTranslations('shell.localeSwitcher');
  const active = useLocale() as Locale;
  const router = useRouter();

  function selectLocale(next: Locale) {
    if (next === active) return;
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${localeCookieName}=${next}; Path=/; Max-Age=${oneYear}; SameSite=Lax`;
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('label')}>
          <Languages className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t('label')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onSelect={(event) => {
              event.preventDefault();
              selectLocale(locale);
            }}
          >
            <span className="flex-1">{LABELS[locale]}</span>
            {locale === active ? (
              <Check className="h-4 w-4 text-primary" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
