'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { browserHttp } from '@/lib/http/browser';

type State = 'verifying' | 'success' | 'error';

interface VerifyEmailControllerProps {
  token: string;
}

export function VerifyEmailController({ token }: VerifyEmailControllerProps) {
  const t = useTranslations('auth.verifyEmail');
  const [state, setState] = useState<State>('verifying');
  const guard = useRef(false);

  useEffect(() => {
    if (guard.current) return;
    guard.current = true;
    browserHttp
      .post('/auth/email/verify', { token })
      .then(() => setState('success'))
      .catch(() => setState('error'));
  }, [token]);

  if (state === 'verifying') {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {t('verifying')}
      </p>
    );
  }
  if (state === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm"
      >
        <p className="font-medium text-foreground">{t('successTitle')}</p>
        <p className="text-muted-foreground">{t('successBody')}</p>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm"
    >
      <p className="font-medium text-destructive">{t('errorTitle')}</p>
      <p className="text-muted-foreground">{t('errorBody')}</p>
    </div>
  );
}
