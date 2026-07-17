import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { getLocale, getMessages } from 'next-intl/server';
import { Providers } from './providers';
import { SkipToContent } from '@/components/shell/SkipToContent';
import './globals.css';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Tasker',
  description: 'Multi-tenant project management SaaS',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${plusJakartaSans.variable} font-sans antialiased`}>
        <Providers locale={locale} messages={messages}>
          <SkipToContent />
          {children}
        </Providers>
      </body>
    </html>
  );
}
