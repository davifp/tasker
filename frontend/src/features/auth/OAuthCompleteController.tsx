'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { bff } from '@/lib/http/bff';

interface OAuthCompleteControllerProps {
  provider: string;
}

interface CompleteResponse {
  redirectTo: string;
}

function parseHash(hash: string): { accessToken?: string; refreshToken?: string; error?: string } {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(clean);
  return {
    accessToken: params.get('accessToken') ?? undefined,
    refreshToken: params.get('refreshToken') ?? undefined,
    error: params.get('error') ?? undefined,
  };
}

function safeRedirect(candidate: string | null): string {
  if (!candidate) return '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return candidate;
}

export function OAuthCompleteController({ provider }: OAuthCompleteControllerProps) {
  const t = useTranslations('auth.oauthComplete');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const [errorKey, setErrorKey] = useState<string>('generic');
  const guard = useRef(false);

  useEffect(() => {
    if (guard.current) return;
    guard.current = true;

    const { accessToken, refreshToken, error } = parseHash(window.location.hash);

    if (window.history.replaceState) {
      const cleaned = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, '', cleaned);
    }

    if (error) {
      setErrorKey(error);
      setStatus('error');
      return;
    }

    if (!accessToken || !refreshToken) {
      setErrorKey('missingTokens');
      setStatus('error');
      return;
    }

    const redirectTo = safeRedirect(searchParams.get('redirectTo'));

    bff
      .post<CompleteResponse>('/auth/oauth-complete', { accessToken, refreshToken, redirectTo })
      .then((result) => {
        router.replace(result.redirectTo || '/');
        router.refresh();
      })
      .catch(() => {
        setErrorKey('exchangeFailed');
        setStatus('error');
      });
  }, [provider, router, searchParams]);

  if (status === 'error') {
    const errorMessage =
      errorKey === 'missingTokens'
        ? t('errors.missingTokens')
        : errorKey === 'exchangeFailed'
          ? t('errors.exchangeFailed')
          : t('errors.generic');
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm"
      >
        <p className="font-medium text-destructive">{t('errorTitle')}</p>
        <p className="text-muted-foreground">{errorMessage}</p>
      </div>
    );
  }

  return (
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
      {t('completing', { provider })}
    </p>
  );
}
