import { redirect } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getSession } from '@/lib/session/session';
import { MAIN_CONTENT_ID } from '@/components/shell/SkipToContent';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session) redirect('/');
  return <AuthLayoutShell>{children}</AuthLayoutShell>;
}

function AuthLayoutShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('auth');
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center px-6 py-4">
          <span className="text-lg font-semibold text-foreground">{t('brand')}</span>
        </div>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12"
      >
        {children}
      </main>
    </div>
  );
}
