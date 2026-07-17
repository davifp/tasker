import { LayoutDashboard } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export default async function ProjectsPlaceholder() {
  const t = await getTranslations('shell.placeholders.projects');
  return (
    <PlaceholderPage
      icon={LayoutDashboard}
      title={t('title')}
      description={t('description')}
      comingSoon={t('comingSoon')}
    />
  );
}
