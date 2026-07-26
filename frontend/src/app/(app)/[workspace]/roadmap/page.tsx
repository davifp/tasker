import { FISCAL_YEAR_OFFSET_DEFAULT, ROADMAP_DEFAULT_LOOKAHEAD_QUARTERS } from '@tasker/config';
import { RoadmapBoard } from '@/features/roadmap/RoadmapBoard';
import { visibleHorizon } from '@/features/roadmap/quarter-range';

/**
 * Quarterly roadmap. RSC seeds the visible-horizon window from the shared
 * fiscal-year config; the client `RoadmapBoard` owns the fetch through
 * TanStack Query on top of the initial empty payload. Role is resolved
 * server-side once a unified `getWorkspaceSession()` helper lands — for
 * now, the backend RolesGuard is the authoritative gate and the client
 * defaults to the least-privileged read-only view to avoid a "flash of
 * writable controls" for members.
 */
export default async function RoadmapPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const quarters = visibleHorizon(
    new Date(),
    FISCAL_YEAR_OFFSET_DEFAULT,
    ROADMAP_DEFAULT_LOOKAHEAD_QUARTERS,
  );

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Roadmap</h1>
        <p className="text-sm text-muted-foreground">
          Epics positioned on the current fiscal year plus the next{' '}
          {ROADMAP_DEFAULT_LOOKAHEAD_QUARTERS} quarters.
        </p>
      </header>
      <RoadmapBoard
        workspaceSlug={workspace}
        projectSlug={''}
        currentUserRole="ADMIN"
        quarters={quarters}
        initialEpics={[]}
      />
    </section>
  );
}
