import { serverHttp } from '@/lib/http/server';
import { HttpError } from '@/lib/http/errors';
import type { CursorPage, Project } from '@/lib/http/types';
import type { Sprint } from '@/lib/http/sprints';
import { SprintList } from '@/features/sprints/SprintList';
import { SprintsIndexHeader } from '@/features/sprints/SprintsIndexHeader';

async function fetchProjects(workspaceSlug: string): Promise<Project[]> {
  try {
    const page = await serverHttp.get<CursorPage<Project>>(
      `/api/v1/workspaces/${workspaceSlug}/projects?status=ACTIVE&limit=50`,
    );
    return page.items;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return [];
    throw error;
  }
}

async function fetchSprints(workspaceSlug: string, projectSlug: string): Promise<Sprint[]> {
  try {
    const page = await serverHttp.get<CursorPage<Sprint>>(
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectSlug}/sprints?limit=25`,
    );
    return page.items;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return [];
    return [];
  }
}

export default async function SprintsIndexPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const projects = await fetchProjects(workspace);
  const sprintsByProject = await Promise.all(
    projects.map(async (project) => ({
      project,
      sprints: await fetchSprints(workspace, project.slug),
    })),
  );

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Sprints</h1>
        <p className="text-sm text-muted-foreground">
          Plan sprints, assign stories, and monitor sprint burndown.
        </p>
      </header>

      {projects.length === 0 ? (
        <p
          className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
          data-testid="sprints-no-projects"
        >
          Create a project first — sprints belong to a project.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {sprintsByProject.map(({ project, sprints }) => (
            <article
              key={project.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
              data-testid={`sprints-project-${project.slug}`}
            >
              <SprintsIndexHeader
                workspaceSlug={workspace}
                projectSlug={project.slug}
                projectName={project.name}
              />
              <SprintList workspaceSlug={workspace} projectSlug={project.slug} sprints={sprints} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
