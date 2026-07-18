import { notFound } from 'next/navigation';
import { serverHttp } from '@/lib/http/server';
import { HttpError } from '@/lib/http/errors';
import type { Project } from '@/lib/http/types';
import { ProjectHeader, PROJECT_TABPANEL_ID } from '@/features/projects/ProjectHeader';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspace: string; project: string }>;
}

async function fetchProject(workspaceSlug: string, projectSlug: string): Promise<Project | null> {
  try {
    return await serverHttp.get<Project>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectSlug}`,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

export default async function ProjectLayout({ children, params }: LayoutProps) {
  const { workspace, project: projectSlug } = await params;
  const project = await fetchProject(workspace, projectSlug);
  if (!project) notFound();
  return (
    <div className="flex flex-col gap-6">
      <ProjectHeader workspaceSlug={workspace} project={project} />
      <div id={PROJECT_TABPANEL_ID} role="tabpanel" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
