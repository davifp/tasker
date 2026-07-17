'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ResendVerificationButton } from './ResendVerificationButton';

interface VerificationBannerProps {
  email: string;
}

export function VerificationBanner({ email }: VerificationBannerProps) {
  const t = useTranslations('auth.verification');
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-foreground"
    >
      <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {t.rich('bannerMessage', {
          email: () => <strong className="font-semibold">{email}</strong>,
        })}
      </span>
      <ResendVerificationButton />
    </div>
  );
}
