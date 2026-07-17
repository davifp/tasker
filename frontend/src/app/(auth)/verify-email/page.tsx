import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { VerifyEmailController } from '@/features/auth/VerifyEmailController';

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams;
  const t = await getTranslations('auth.verifyEmail');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {token ? (
        <VerifyEmailController token={token} />
      ) : (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {t('checkYourEmail')}
        </p>
      )}
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary underline underline-offset-4">
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
