import { LineChart } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export default async function DashboardPlaceholder() {
  const t = await getTranslations('shell.placeholders.dashboard');
  return (
    <PlaceholderPage
      icon={LineChart}
      title={t('title')}
      description={t('description')}
      comingSoon={t('comingSoon')}
    />
  );
}
