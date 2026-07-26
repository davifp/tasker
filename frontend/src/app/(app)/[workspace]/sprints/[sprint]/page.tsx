import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SprintPlanner } from '@/features/sprints/SprintPlanner';

interface Params {
  workspace: string;
  sprint: string;
}

interface SearchParams {
  project?: string;
}

/**
 * Sprint detail. `[sprint]` is the sprint number. `?project=` scopes the
 * fetch — sprints are per-project so we need the slug in the URL to
 * disambiguate. In this iteration we lean on the client-side planner to
 * hydrate its data (initial arrays passed empty; SprintPlanner accepts a
 * cold state and the planner mutations fill it in). The dashboard route
 * (Task 9.0) will fetch the burndown into this same page as a sibling tab.
 */
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
        initialBacklog={[]}
        initialSprint={[]}
      />
    </section>
  );
}
