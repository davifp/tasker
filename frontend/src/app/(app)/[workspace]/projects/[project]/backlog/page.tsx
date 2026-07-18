import { getTranslations } from 'next-intl/server';
import { ProjectTabPlaceholder } from '@/features/projects/ProjectTabPlaceholder';

export default async function ProjectBacklogView() {
  const t = await getTranslations('projects.placeholders');
  return <ProjectTabPlaceholder title={t('comingSoon')} body={t('backlogBody')} />;
}
