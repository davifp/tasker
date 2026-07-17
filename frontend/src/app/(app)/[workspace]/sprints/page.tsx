import { BarChart3 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export default async function SprintsPlaceholder() {
  const t = await getTranslations('shell.placeholders.sprints');
  return (
    <PlaceholderPage
      icon={BarChart3}
      title={t('title')}
      description={t('description')}
      comingSoon={t('comingSoon')}
    />
  );
}
