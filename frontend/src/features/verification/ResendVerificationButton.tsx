'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { browserHttp } from '@/lib/http/browser';
import { HttpError } from '@/lib/http/errors';
import { Button } from '@/components/ui/button';

const COOLDOWN_SECONDS = 60;

export function ResendVerificationButton() {
  const t = useTranslations('auth.verification');
  const [remaining, setRemaining] = useState(0);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  function onClick() {
    if (remaining > 0 || isPending) return;
    startTransition(async () => {
      try {
        await browserHttp.post('/auth/email/verify/resend', {});
        toast.success(t('resendSuccess'));
      } catch (error) {
        if (error instanceof HttpError && error.status === 429) {
          toast.error(t('resendRateLimited'));
        } else {
          toast.error(t('resendFailed'));
        }
      } finally {
        setRemaining(COOLDOWN_SECONDS);
      }
    });
  }

  const disabled = remaining > 0 || isPending;
  const label =
    remaining > 0
      ? t('resendCooldown', { seconds: remaining })
      : isPending
        ? t('resending')
        : t('resend');

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-live="polite"
    >
      {label}
    </Button>
  );
}
