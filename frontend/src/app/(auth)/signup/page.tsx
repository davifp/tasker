import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SignupForm } from '@/features/auth/SignupForm';
import { OAuthProviders, AuthDivider } from '@/features/auth/OAuthProviders';

export default function SignupPage() {
  const t = useTranslations('auth.signup');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <OAuthProviders action="signup" />
      <AuthDivider />
      <SignupForm />
      <p className="text-center text-sm text-muted-foreground">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          {t('signInLink')}
        </Link>
      </p>
    </div>
  );
}
