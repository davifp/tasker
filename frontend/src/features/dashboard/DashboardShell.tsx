'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import {
  METRICS_DEFAULT_WINDOW,
  METRICS_WINDOW_PRESETS,
  type MetricsWindowPreset,
} from '@tasker/config';
import type { WorkspaceRole } from '@/lib/http/types';
import { dashboardHttp } from '@/lib/http/dashboard';
import { HttpError } from '@/lib/http/errors';
import { dashboardKeys } from '@/features/queryKeys';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BurndownChart } from './BurndownChart';
import { CycleLeadTimeChart } from './CycleLeadTimeChart';
import { KpiCard } from './KpiCard';
import { MetricDefinitionPopover } from './MetricDefinitionPopover';

export interface DashboardShellProps {
  workspaceSlug: string;
  currentUserRole: WorkspaceRole;
  activeSprint?: {
    projectSlug: string;
    sprintNumber: number;
  } | null;
}

export function DashboardShell({
  workspaceSlug,
  currentUserRole,
  activeSprint,
}: DashboardShellProps): React.JSX.Element {
  const [window, setWindow] = useState<MetricsWindowPreset>(METRICS_DEFAULT_WINDOW);
  const queryClient = useQueryClient();

  const cycleQuery = useQuery({
    queryKey: dashboardKeys.cycleLeadTime(workspaceSlug, { window }),
    queryFn: () => dashboardHttp.cycleLeadTime(workspaceSlug, { window }),
  });

  const burndownQuery = useQuery({
    queryKey: activeSprint
      ? dashboardKeys.burndown(workspaceSlug, activeSprint.projectSlug, activeSprint.sprintNumber)
      : ['dashboard', 'burndown', 'idle'],
    queryFn: () =>
      activeSprint
        ? dashboardHttp.burndown(workspaceSlug, activeSprint.projectSlug, activeSprint.sprintNumber)
        : Promise.resolve(null),
    enabled: Boolean(activeSprint),
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const idempotencyKey = crypto.randomUUID();
      await dashboardHttp.refresh(workspaceSlug, idempotencyKey);
    },
    onSuccess: async () => {
      toast.success('Refresh queued');
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all(workspaceSlug) });
    },
    onError: (err) => {
      const message =
        err instanceof HttpError ? (err.detail ?? err.title ?? err.message) : 'Refresh failed';
      toast.error(message);
    },
  });

  const asOf = cycleQuery.data?.asOf ?? burndownQuery.data?.asOf ?? null;
  const coldCache = !asOf && cycleQuery.data && cycleQuery.data.data.length === 0;

  return (
    <TooltipProvider delayDuration={250}>
      <section className="flex flex-col gap-6">
        <header className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <p className="text-xs text-muted-foreground" data-testid="dashboard-as-of">
              {asOf ? `Data as of ${new Date(asOf).toLocaleString()}` : 'Computing…'}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Window</span>
            <select
              value={window}
              onChange={(e) => setWindow(e.target.value as MetricsWindowPreset)}
              className="rounded border border-border bg-background px-2 py-1 text-xs"
              aria-label="Metric window"
            >
              {METRICS_WINDOW_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          {currentUserRole === 'OWNER' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
              data-testid="dashboard-refresh"
            >
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
              {refresh.isPending ? 'Queuing…' : 'Refresh now'}
            </Button>
          ) : null}
        </header>

        {coldCache ? (
          <p
            className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
            data-testid="dashboard-cold-cache"
          >
            Metrics are computing. This usually takes under a minute on first paint.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Median lead time"
                value={formatHours(latest(cycleQuery.data?.data)?.medianLeadTime ?? 0)}
                unit="business h"
              >
                <MetricDefinitionPopover metric="leadTime" />
              </KpiCard>
              <KpiCard
                label="P90 lead time"
                value={formatHours(latest(cycleQuery.data?.data)?.p90LeadTime ?? 0)}
                unit="business h"
              >
                <MetricDefinitionPopover metric="leadTime" />
              </KpiCard>
              <KpiCard
                label="Median cycle time"
                value={formatHours(latest(cycleQuery.data?.data)?.medianCycleTime ?? 0)}
                unit="business h"
              >
                <MetricDefinitionPopover metric="cycleTime" />
              </KpiCard>
              <KpiCard
                label="P90 cycle time"
                value={formatHours(latest(cycleQuery.data?.data)?.p90CycleTime ?? 0)}
                unit="business h"
              >
                <MetricDefinitionPopover metric="cycleTime" />
              </KpiCard>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">Cycle &amp; lead time</h2>
                <CycleLeadTimeChart window={window} distributions={cycleQuery.data?.data ?? []} />
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  Burndown{' '}
                  {activeSprint ? `— Sprint ${activeSprint.sprintNumber}` : '(no active sprint)'}
                </h2>
                {activeSprint && burndownQuery.data ? (
                  <BurndownChart
                    sprintNumber={activeSprint.sprintNumber}
                    points={burndownQuery.data.data}
                  />
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Open a project and start a sprint to see its burndown here.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </TooltipProvider>
  );
}

function latest<T>(rows: T[] | undefined): T | undefined {
  if (!rows || rows.length === 0) return undefined;
  return rows[rows.length - 1];
}

function formatHours(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
