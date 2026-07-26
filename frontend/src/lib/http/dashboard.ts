import type { CycleLeadTimeQuery } from '@tasker/config';
import { browserHttp } from './browser';
import type { SprintCloseSummary } from './sprints';

export interface BurndownPoint {
  day: string;
  plannedPoints: number;
  completedPoints: number;
  remainingPoints: number;
}

export interface DistributionSummary {
  bucketWeek: string;
  count: number;
  medianLeadTime: number;
  p90LeadTime: number;
  medianCycleTime: number;
  p90CycleTime: number;
}

export interface DashboardResponse<T> {
  data: T;
  asOf: string | null;
}

function base(workspaceSlug: string): string {
  return `/workspaces/${workspaceSlug}`;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const dashboardHttp = {
  burndown(workspaceSlug: string, projectSlug: string, sprintNumber: number) {
    return browserHttp.get<DashboardResponse<BurndownPoint[]>>(
      `${base(workspaceSlug)}/projects/${projectSlug}/sprints/${sprintNumber}/burndown`,
    );
  },
  cycleLeadTime(workspaceSlug: string, query: CycleLeadTimeQuery = { window: 'last_quarter' }) {
    return browserHttp.get<DashboardResponse<DistributionSummary[]>>(
      `${base(workspaceSlug)}/dashboard/cycle-lead-time${toQuery(query as unknown as Record<string, unknown>)}`,
    );
  },
  sprintClose(workspaceSlug: string, sprintId: string) {
    return browserHttp.get<DashboardResponse<SprintCloseSummary>>(
      `${base(workspaceSlug)}/dashboard/sprint-close/${sprintId}`,
    );
  },
  refresh(workspaceSlug: string, idempotencyKey?: string) {
    return browserHttp.post<{ queued: true }>(
      `${base(workspaceSlug)}/dashboard/refresh`,
      {},
      { idempotencyKey },
    );
  },
};
