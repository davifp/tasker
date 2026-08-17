import { redirect } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { EXPIRE_PATH, verifySession } from '@/lib/session/require';
import { MAIN_CONTENT_ID } from '@/components/shell/SkipToContent';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const verified = await verifySession();
  // Real signed-in session → bounce to the app root.
  if (verified.status === 'authenticated') redirect('/');
  // Stale cookie whose JWT the backend no longer accepts → destroy it via
  // the Route Handler before rendering the login form, otherwise every
  // guard would keep redirecting back here and produce a loop.
  if (verified.status === 'expired') redirect(`${EXPIRE_PATH}?next=/login`);
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
