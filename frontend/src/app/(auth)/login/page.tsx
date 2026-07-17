import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LoginForm } from '@/features/auth/LoginForm';
import { OAuthProviders, AuthDivider } from '@/features/auth/OAuthProviders';

export default function LoginPage() {
  const t = useTranslations('auth.login');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <OAuthProviders action="signin" />
      <AuthDivider />
      <LoginForm />
      <p className="text-center text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link href="/signup" className="text-primary underline underline-offset-4">
          {t('signUpLink')}
        </Link>
      </p>
    </div>
  );
}
