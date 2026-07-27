import { getTranslations } from 'next-intl/server';
import { NotificationsView } from '@/features/notifications/NotificationsView';

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const [{ workspace }, t] = await Promise.all([params, getTranslations('notifications.page')]);
  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <NotificationsView workspaceSlug={workspace} />
    </section>
  );
}
