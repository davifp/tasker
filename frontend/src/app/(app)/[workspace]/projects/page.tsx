import { ProjectListPage } from '@/features/projects/ProjectListPage';

interface PageProps {
  params: Promise<{ workspace: string }>;
}

export default async function ProjectsListRoute({ params }: PageProps) {
  const { workspace } = await params;
  return <ProjectListPage workspaceSlug={workspace} />;
}
