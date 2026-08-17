import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SignupForm } from '@/features/auth/SignupForm';
import { OAuthProviders, AuthDivider } from '@/features/auth/OAuthProviders';
import { redirectIfAuthenticated } from '@/lib/session/require';

export default async function SignupPage() {
  await redirectIfAuthenticated();
  const t = await getTranslations('auth.signup');
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
        <Link href="/login" className="text-primary underline underline-offset-4">
          {t('signInLink')}
        </Link>
      </p>
    </div>
  );
}
