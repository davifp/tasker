import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ForgotPasswordForm } from '@/features/auth/ForgotPasswordForm';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth.forgotPassword');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <ForgotPasswordForm />
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
