import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ForgotPasswordForm } from '@/features/auth/ForgotPasswordForm';
import { redirectIfAuthenticated } from '@/lib/session/require';

export default async function ForgotPasswordPage() {
  await redirectIfAuthenticated();
  const t = await getTranslations('auth.forgotPassword');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <ForgotPasswordForm />
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary underline underline-offset-4">
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
