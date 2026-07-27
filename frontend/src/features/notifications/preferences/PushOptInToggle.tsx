'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { usePushRegistration } from '@/features/push/usePushRegistration';

// Sibling to the (event × channel) matrix. Web Push cannot be enabled from
// a checkbox alone — the browser requires a user gesture that produces a
// permission prompt — so we surface it here as an explicit action.
export function PushOptInToggle() {
  const t = useTranslations('notifications.push');
  const { support, permission, state, isSubscribed, subscribe, unsubscribe, error } =
    usePushRegistration();

  if (support === 'unsupported') {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t('unsupported')}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t('title')}</p>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        {isSubscribed ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void unsubscribe()}
            disabled={state === 'registering'}
          >
            {t('disable')}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => void subscribe()}
            disabled={state === 'registering' || permission === 'denied'}
          >
            {state === 'registering' ? t('working') : t('enable')}
          </Button>
        )}
      </div>
      {permission === 'denied' ? (
        <p className="mt-2 text-xs text-destructive">{t('permissionDenied')}</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive">{t('error')}</p> : null}
    </div>
  );
}
