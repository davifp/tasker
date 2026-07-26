import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { Sprint } from '@/lib/http/sprints';

export interface SprintListProps {
  workspaceSlug: string;
  projectSlug: string;
  sprints: Sprint[];
}

/**
 * Server-side list of sprints scoped to one project. Kept intentionally
 * dumb — the RSC parent hydrates the initial page and any drill-in lands
 * on `sprints/[sprint]`, where TanStack Query takes over.
 */
export function SprintList({
  workspaceSlug,
  projectSlug,
  sprints,
}: SprintListProps): React.JSX.Element {
  if (sprints.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="sprint-list-empty">
        No sprints yet. Create one to start planning.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {sprints.map((sprint) => (
        <li key={sprint.id} className="p-3">
          <Link
            href={`/${workspaceSlug}/sprints/${sprint.number}?project=${projectSlug}`}
            className="flex items-center justify-between gap-3 hover:text-primary"
          >
            <span className="flex flex-col">
              <span className="font-medium">
                Sprint {sprint.number} — {sprint.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {sprint.startDate.slice(0, 10)} → {sprint.endDate.slice(0, 10)}
              </span>
            </span>
            <SprintStateBadge state={sprint.state} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SprintStateBadge({ state }: { state: Sprint['state'] }): React.JSX.Element {
  const variant = state === 'ACTIVE' ? 'default' : state === 'COMPLETED' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{state}</Badge>;
}
