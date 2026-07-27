import { getTranslations } from 'next-intl/server';
import { PreferencesMatrixForm } from '@/features/notifications/preferences/PreferencesMatrixForm';
import { PushOptInToggle } from '@/features/notifications/preferences/PushOptInToggle';

export default async function NotificationPreferencesPage() {
  const t = await getTranslations('notifications.preferences');
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <PreferencesMatrixForm />
      <PushOptInToggle />
    </section>
  );
}
