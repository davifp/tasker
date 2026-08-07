import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SprintPlanner } from '@/features/sprints/SprintPlanner';
import type { PlannerTask } from '@/features/sprints/plannerReducer';
import { serverHttp } from '@/lib/http/server';
import type { CursorPage, Task } from '@/lib/http/types';
import type { Sprint } from '@/lib/http/sprints';

interface Params {
  workspace: string;
  sprint: string;
}

interface SearchParams {
  project?: string;
}

// Hydrate the planner from server-side so both panes land populated on the
// first paint (Backlog = project tasks with no sprint, Sprint = tasks
// pre-assigned to this sprint). Previous iteration passed empty arrays and
// relied on user mutations to fill them in — that showed both panes empty
// with no source to drag from (see BUG-14).
function toPlannerTask(task: Task & { estimate?: number | null }): PlannerTask {
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    estimate: (task as { estimate?: number | null }).estimate ?? null,
    assigneeUserId: task.assigneeUserId,
  };
}

async function fetchPlannerTasks(
  workspaceSlug: string,
  projectSlug: string,
  sprintId: string,
): Promise<{ backlog: PlannerTask[]; sprint: PlannerTask[] }> {
  const base = `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectSlug)}/tasks`;
  const [backlogPage, sprintPage] = await Promise.all([
    serverHttp
      .get<CursorPage<Task>>(`${base}?limit=100&sprintId=none`)
      .catch(() => ({ items: [], nextCursor: null }) as CursorPage<Task>),
    serverHttp
      .get<CursorPage<Task>>(`${base}?limit=100&sprintId=${encodeURIComponent(sprintId)}`)
      .catch(() => ({ items: [], nextCursor: null }) as CursorPage<Task>),
  ]);
  return {
    backlog: backlogPage.items.map(toPlannerTask),
    sprint: sprintPage.items.map(toPlannerTask),
  };
}

export default async function SprintDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { workspace, sprint } = await params;
  const { project } = await searchParams;
  const sprintNumber = Number(sprint);
  if (!Number.isFinite(sprintNumber) || !project) notFound();

  const sprintDetail = await serverHttp
    .get<Sprint>(
      `/api/v1/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/sprints/${sprintNumber}`,
    )
    .catch(() => null);

  const { backlog, sprint: sprintTasks } = sprintDetail
    ? await fetchPlannerTasks(workspace, project, sprintDetail.id)
    : { backlog: [], sprint: [] };

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sprint {sprintNumber}</h1>
          <p className="text-sm text-muted-foreground">
            Project <span className="font-medium">{project}</span>
          </p>
        </div>
        <Link
          href={`/${workspace}/dashboard?project=${project}&sprint=${sprintNumber}`}
          className="text-sm text-primary underline"
        >
          Open burndown
        </Link>
      </header>
      <SprintPlanner
        workspaceSlug={workspace}
        projectSlug={project}
        sprintNumber={sprintNumber}
        initialBacklog={backlog}
        initialSprint={sprintTasks}
      />
    </section>
  );
}
