import { notFound } from 'next/navigation';
import { requireSession, fetchMyWorkspaces } from '@/lib/session/require';
import { serverHttp } from '@/lib/http/server';
import { HttpError } from '@/lib/http/errors';
import type { Project, WorkspaceRole } from '@/lib/http/types';
import { TaskFilters } from '@/features/tasks/TaskFilters';
import { TimelineView } from '@/features/tasks/views/TimelineView';

interface TimelinePageProps {
  params: Promise<{ workspace: string; project: string }>;
}

// Server shell — resolves session + project once, hands the tenant-scoped
// identifiers off to the client `<TimelineView />`. Mirrors the Calendar
// / Backlog / List shells so the project header (rendered by
// `layout.tsx`), the filter chip bar, and the tab body share one visual
// rhythm.
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

export default async function ProjectTimelinePage({ params }: TimelinePageProps) {
  const { workspace: workspaceSlug, project: projectSlug } = await params;
  const session = await requireSession();
  const [project, workspaces] = await Promise.all([
    fetchProject(workspaceSlug, projectSlug),
    fetchMyWorkspaces(session.accessToken),
  ]);
  if (!project) notFound();
  const active = workspaces.find((membership) => membership.slug === workspaceSlug);
  if (!active) notFound();
  const role = (active.role ?? 'MEMBER') as WorkspaceRole;
  return (
    <div className="flex flex-col gap-3">
      <TaskFilters workspaceSlug={workspaceSlug} currentUserId={session.userId} />
      <TimelineView
        workspaceSlug={workspaceSlug}
        workspaceId={active.id}
        projectSlug={projectSlug}
        projectId={project.id}
        currentUserId={session.userId}
        currentUserRole={role}
      />
    </div>
  );
}
