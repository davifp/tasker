'use client';

import { useTranslations } from 'next-intl';
import { Github } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Provider = 'google' | 'github';

function providerUrl(provider: Provider): string {
  return `/api/proxy/auth/oauth/${provider}`;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v3.2h5.35c-.23 1.5-1.66 4.4-5.35 4.4-3.22 0-5.85-2.66-5.85-5.95s2.63-5.95 5.85-5.95c1.83 0 3.06.78 3.77 1.45l2.57-2.48C16.86 4.28 14.65 3.25 12 3.25 7.03 3.25 3 7.28 3 12.25s4.03 9 9 9c5.19 0 8.63-3.64 8.63-8.77 0-.59-.07-1.04-.28-1.38z"
      />
    </svg>
  );
}

interface OAuthProvidersProps {
  action: 'signin' | 'signup';
}

export function OAuthProviders({ action }: OAuthProvidersProps) {
  const t = useTranslations('auth.oauth');
  const label = action === 'signin' ? t('signInWith') : t('signUpWith');

  return (
    <div className="flex flex-col gap-3">
      <Button asChild variant="outline" className="h-11 justify-center text-base">
        <a href={providerUrl('google')} rel="nofollow">
          <GoogleIcon />
          <span>{label} Google</span>
        </a>
      </Button>
      <Button asChild variant="outline" className="h-11 justify-center text-base">
        <a href={providerUrl('github')} rel="nofollow">
          <Github className="h-4 w-4" aria-hidden="true" />
          <span>{label} GitHub</span>
        </a>
      </Button>
    </div>
  );
}

export function AuthDivider() {
  const t = useTranslations('auth.oauth');
  return (
    <div className="relative py-2 text-center text-xs text-muted-foreground" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
      <span className="bg-background px-3 uppercase tracking-wider">{t('or')}</span>
    </div>
  );
}
