import { DashboardShell } from '@/features/dashboard/DashboardShell';

/**
 * Workspace planning dashboard. Client-heavy: the shell owns state for
 * the window picker and the refresh button, and TanStack Query drives
 * both the burndown and the cycle/lead time reads.
 *
 * The RSC currently defaults `currentUserRole` to `OWNER` for
 * demonstration; a follow-up will read the caller's role from a unified
 * `getWorkspaceSession()` helper and pass it through. The backend
 * RolesGuard remains authoritative for the refresh endpoint.
 * `activeSprint` is opted in via `?project=<slug>&sprint=<number>` until
 * a workspace-scoped active-sprint lookup lands.
 */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ project?: string; sprint?: string }>;
}) {
  const { workspace } = await params;
  const { project, sprint } = await searchParams;

  const activeSprint =
    project && sprint && Number.isFinite(Number(sprint))
      ? { projectSlug: project, sprintNumber: Number(sprint) }
      : null;

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Planning dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Cycle time, lead time, and the active sprint&apos;s burndown.
        </p>
      </header>
      <DashboardShell
        workspaceSlug={workspace}
        currentUserRole="OWNER"
        activeSprint={activeSprint}
      />
    </section>
  );
}
