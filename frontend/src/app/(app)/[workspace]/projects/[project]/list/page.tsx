import { getTranslations } from 'next-intl/server';
import { ProjectTabPlaceholder } from '@/features/projects/ProjectTabPlaceholder';

export default async function ProjectListView() {
  const t = await getTranslations('projects.placeholders');
  return <ProjectTabPlaceholder title={t('comingSoon')} body={t('listBody')} />;
}
