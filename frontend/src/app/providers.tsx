'use client';

import { useEffect, useState } from 'react';
import type { AbstractIntlMessages } from 'next-intl';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { AnalyticsProvider } from '@/features/analytics/AnalyticsProvider';
import { defaultTimeZone } from '@/i18n/config';
import { initOtelWeb } from '@/observability/otel-web';

interface ProvidersProps {
  children: React.ReactNode;
  locale: string;
  messages: AbstractIntlMessages;
}

export function Providers({ children, locale, messages }: ProvidersProps) {
  // Initialize the OTel-web tracer provider once per browser session so
  // outbound fetches can propagate `traceparent`. Runs in useEffect (never on
  // the server) to keep the module free of window/document references.
  useEffect(() => {
    initOtelWeb();
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={defaultTimeZone}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AnalyticsProvider>{children}</AnalyticsProvider>
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}
