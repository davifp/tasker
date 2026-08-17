import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ResetPasswordForm } from '@/features/auth/ResetPasswordForm';
import { redirectIfAuthenticated } from '@/lib/session/require';

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  await redirectIfAuthenticated();
  const { token } = await searchParams;
  const t = await getTranslations('auth.resetPassword');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          <p className="font-medium text-destructive">{t('missingTokenTitle')}</p>
          <p className="text-muted-foreground">{t('missingTokenBody')}</p>
          <Link
            href="/forgot-password"
            className="mt-3 inline-block text-primary underline underline-offset-4"
          >
            {t('requestNewLink')}
          </Link>
        </div>
      )}
    </div>
  );
}
