import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { CycleLeadTimeQuery, MetricsWindowPreset } from '@tasker/config';
import { PrismaService } from '../prisma/prisma.service';
import { METRICS_QUEUE, METRICS_REFRESH_JOB_WORKSPACE } from '../queues/constants';

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

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(METRICS_QUEUE) private readonly refreshQueue: Queue,
  ) {}

  async burndown(
    workspaceId: string,
    sprintId: string,
  ): Promise<DashboardResponse<BurndownPoint[]>> {
    const sprint = await this.prisma.forSystem().sprint.findUnique({
      where: { id: sprintId },
      select: { workspaceId: true },
    });
    if (!sprint || sprint.workspaceId !== workspaceId) {
      throw new NotFoundException('Sprint not found');
    }

    // Reading a matview via raw SQL — Prisma has no first-class MV support.
    // Explicit workspace filter (defence-in-depth on top of the fact that
    // the caller has already verified sprint→workspace ownership above).
    const rows = await this.prisma.forSystem().$queryRawUnsafe<
      Array<{
        day: Date;
        plannedPoints: number;
        completedPoints: number;
        remainingPoints: number;
      }>
    >(
      `SELECT "day", "plannedPoints", "completedPoints", "remainingPoints"
       FROM "mv_sprint_daily_burndown"
       WHERE "workspaceId" = $1 AND "sprintId" = $2
       ORDER BY "day" ASC`,
      workspaceId,
      sprintId,
    );

    const data: BurndownPoint[] = rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      plannedPoints: Number(r.plannedPoints),
      completedPoints: Number(r.completedPoints),
      remainingPoints: Number(r.remainingPoints),
    }));

    const asOf = await this.asOf(workspaceId);
    return { data, asOf };
  }

  async cycleLeadTime(
    workspaceId: string,
    query: CycleLeadTimeQuery,
  ): Promise<DashboardResponse<DistributionSummary[]>> {
    const { from, to } = this.resolveWindow(query);

    const rows = await this.prisma.forSystem().$queryRawUnsafe<
      Array<{
        bucketWeek: Date;
        count: bigint | number;
        medianLead: number;
        p90Lead: number;
        medianCycle: number;
        p90Cycle: number;
      }>
    >(
      `SELECT
         "bucketWeek",
         COUNT(*)::int                                                 AS "count",
         COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY "leadTimeBusinessHours"), 0)  AS "medianLead",
         COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY "leadTimeBusinessHours"), 0)  AS "p90Lead",
         COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY "cycleTimeBusinessHours"), 0) AS "medianCycle",
         COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY "cycleTimeBusinessHours"), 0) AS "p90Cycle"
       FROM "mv_workspace_cycle_lead_time"
       WHERE "workspaceId" = $1 AND "doneAt" >= $2 AND "doneAt" < $3
       ${query.projectId ? 'AND "projectId" = $4' : ''}
       GROUP BY "bucketWeek"
       ORDER BY "bucketWeek" ASC`,
      ...([workspaceId, from, to, ...(query.projectId ? [query.projectId] : [])] as unknown[]),
    );

    const data: DistributionSummary[] = rows.map((r) => ({
      bucketWeek: r.bucketWeek.toISOString().slice(0, 10),
      count: Number(r.count),
      medianLeadTime: Number(r.medianLead),
      p90LeadTime: Number(r.p90Lead),
      medianCycleTime: Number(r.medianCycle),
      p90CycleTime: Number(r.p90Cycle),
    }));

    const asOf = await this.asOf(workspaceId);
    return { data, asOf };
  }

  /**
   * Enqueues a workspace-scoped refresh job. `Idempotent()` on the controller
   * plus the SETNX mutex inside the processor make repeat triggers safe.
   */
  async triggerRefresh(workspaceId: string): Promise<void> {
    await this.refreshQueue.add(
      METRICS_REFRESH_JOB_WORKSPACE,
      { workspaceId },
      {
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  /**
   * Returns the `finishedAt` timestamp of the most recent successful
   * refresh for `workspaceId`, or `null` for cold-cache workspaces.
   * Global refreshes (workspaceId=null) also count — they update every
   * matview so their finish time is a valid `asOf` for any workspace.
   */
  private async asOf(workspaceId: string): Promise<string | null> {
    const row = await this.prisma.forSystem().metricJobLog.findFirst({
      where: {
        status: 'OK',
        OR: [{ workspaceId }, { workspaceId: null }],
      },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    });
    return row?.finishedAt?.toISOString() ?? null;
  }

  private resolveWindow(query: CycleLeadTimeQuery): { from: Date; to: Date } {
    if (query.from && query.to) {
      return { from: new Date(query.from), to: new Date(query.to) };
    }
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - windowDays(query.window));
    return { from, to };
  }
}

function windowDays(preset: MetricsWindowPreset): number {
  switch (preset) {
    case 'last_week':
      return 7;
    case 'last_month':
      return 31;
    case 'last_quarter':
      return 93;
    case 'last_year':
      return 366;
  }
}
