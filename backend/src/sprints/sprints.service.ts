import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, Sprint, SprintState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/activity/activity.service';
import { SprintSnapshotService } from './sprint-snapshot.service';
import {
  SprintCompletedEvent,
  SprintCreatedEvent,
  SprintEvents,
  SprintStartedEvent,
} from './events/sprint.events';

type PrismaTx = Prisma.TransactionClient;

export interface CreateSprintInput {
  workspaceId: string;
  projectId: string;
  name: string;
  goal?: string;
  startDate: string;
  endDate: string;
  actorUserId: string;
}

export interface UpdateSprintPatch {
  name?: string;
  goal?: string | null;
  startDate?: string;
  endDate?: string;
}

export interface ListSprintsOptions {
  cursor?: string;
  limit?: number;
  state?: SprintState;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SprintCloseSummary {
  sprintId: string;
  plannedCount: number;
  plannedEstimate: number;
  deliveredCount: number;
  deliveredEstimate: number;
  slippedCount: number;
  slippedEstimate: number;
  velocity: number;
  slippedTaskIds: string[];
}

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

@Injectable()
export class SprintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly snapshots: SprintSnapshotService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async create(input: CreateSprintInput): Promise<Sprint> {
    if (new Date(input.startDate).getTime() > new Date(input.endDate).getTime()) {
      throw sprintDateOrderError();
    }

    const sprint = await this.prisma.forSystem().$transaction(async (tx) => {
      const number = await this.claimNextNumber(tx, input.projectId);

      const created = await tx.sprint.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          number,
          name: input.name,
          goal: input.goal,
          state: SprintState.PLANNED,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          createdByUserId: input.actorUserId,
        },
      });

      await this.activity.record(tx, {
        workspaceId: created.workspaceId,
        projectId: created.projectId,
        actorUserId: input.actorUserId,
        verb: 'sprint.created',
        payload: { targetTitle: created.name },
      });

      return created;
    });

    this.events.emit(SprintEvents.CREATED, {
      workspaceId: sprint.workspaceId,
      projectId: sprint.projectId,
      sprintId: sprint.id,
      actorUserId: input.actorUserId,
    } satisfies SprintCreatedEvent);

    return sprint;
  }

  async findByNumber(
    workspaceId: string,
    projectId: string,
    number: number,
  ): Promise<Sprint | null> {
    const sprint = await this.prisma.forSystem().sprint.findUnique({
      where: { projectId_number: { projectId, number } },
    });
    if (!sprint || sprint.workspaceId !== workspaceId) return null;
    return sprint;
  }

  async list(
    workspaceId: string,
    projectId: string,
    opts: ListSprintsOptions = {},
  ): Promise<CursorPage<Sprint>> {
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const items = await this.prisma.forSystem().sprint.findMany({
      where: {
        workspaceId,
        projectId,
        ...(opts.state ? { state: opts.state } : {}),
      },
      orderBy: [{ number: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  async update(workspaceId: string, sprintId: string, patch: UpdateSprintPatch): Promise<Sprint> {
    return this.prisma.forSystem().$transaction(async (tx) => {
      const existing = await tx.sprint.findUnique({ where: { id: sprintId } });
      if (!existing || existing.workspaceId !== workspaceId) {
        throw new NotFoundException('Sprint not found');
      }
      // Only Planned sprints can be edited (name/dates/goal). Active/Completed
      // are frozen — dates in particular MUST NOT drift because they anchor
      // the burndown x-axis.
      if (existing.state !== SprintState.PLANNED) {
        throw sprintNotPlannedError();
      }

      const nextStart = patch.startDate ? new Date(patch.startDate) : existing.startDate;
      const nextEnd = patch.endDate ? new Date(patch.endDate) : existing.endDate;
      if (nextStart.getTime() > nextEnd.getTime()) {
        throw sprintDateOrderError();
      }

      return tx.sprint.update({
        where: { id: sprintId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
          ...(patch.startDate !== undefined ? { startDate: new Date(patch.startDate) } : {}),
          ...(patch.endDate !== undefined ? { endDate: new Date(patch.endDate) } : {}),
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(workspaceId: string, sprintId: string, actorUserId: string): Promise<Sprint> {
    const sprint = await this.prisma.forSystem().$transaction(async (tx) => {
      const existing = await tx.sprint.findUnique({ where: { id: sprintId } });
      if (!existing || existing.workspaceId !== workspaceId) {
        throw new NotFoundException('Sprint not found');
      }
      // Idempotent: starting an already-Active sprint is a no-op.
      if (existing.state === SprintState.ACTIVE) return existing;
      if (existing.state === SprintState.COMPLETED) throw sprintClosedError();

      let updated: Sprint;
      try {
        updated = await tx.sprint.update({
          where: { id: sprintId },
          data: { state: SprintState.ACTIVE, startedAt: new Date() },
        });
      } catch (err) {
        // Partial unique index blocks a second Active sprint in the same
        // project — surface a 409 Problem Details rather than a raw
        // P2002 leak.
        if (isActiveSprintConflict(err)) {
          throw activeSprintExistsError(existing.projectId);
        }
        throw err;
      }

      await this.snapshots.captureOnStart(tx, sprintId);

      await this.activity.record(tx, {
        workspaceId: updated.workspaceId,
        projectId: updated.projectId,
        actorUserId,
        verb: 'sprint.started',
        payload: { targetTitle: updated.name },
      });

      return updated;
    });

    this.events.emit(SprintEvents.STARTED, {
      workspaceId: sprint.workspaceId,
      projectId: sprint.projectId,
      sprintId: sprint.id,
      actorUserId,
    } satisfies SprintStartedEvent);

    return sprint;
  }

  async complete(
    workspaceId: string,
    sprintId: string,
    actorUserId: string,
  ): Promise<SprintCloseSummary> {
    const { summary, wasAlreadyCompleted } = await this.prisma
      .forSystem()
      .$transaction(async (tx) => {
        const existing = await tx.sprint.findUnique({ where: { id: sprintId } });
        if (!existing || existing.workspaceId !== workspaceId) {
          throw new NotFoundException('Sprint not found');
        }
        // Idempotency: completing an already-Completed sprint returns the
        // frozen summary and skips the snapshot + activity emission.
        if (existing.state === SprintState.COMPLETED) {
          const frozen = await this.buildCloseSummary(tx, sprintId);
          return { summary: frozen, wasAlreadyCompleted: true };
        }
        if (existing.state !== SprintState.ACTIVE) throw sprintNotActiveError();

        await tx.sprint.update({
          where: { id: sprintId },
          data: { state: SprintState.COMPLETED, completedAt: new Date() },
        });

        await this.snapshots.captureOnComplete(tx, sprintId);

        await this.activity.record(tx, {
          workspaceId: existing.workspaceId,
          projectId: existing.projectId,
          actorUserId,
          verb: 'sprint.completed',
          payload: { targetTitle: existing.name },
        });

        const built = await this.buildCloseSummary(tx, sprintId);
        return { summary: built, wasAlreadyCompleted: false };
      });

    if (!wasAlreadyCompleted) {
      this.events.emit(SprintEvents.COMPLETED, {
        workspaceId,
        projectId: (
          await this.prisma.forSystem().sprint.findUniqueOrThrow({
            where: { id: sprintId },
            select: { projectId: true },
          })
        ).projectId,
        sprintId,
        actorUserId,
      } satisfies SprintCompletedEvent);
    }

    return summary;
  }

  // ---------------------------------------------------------------------------
  // Derived views
  // ---------------------------------------------------------------------------

  async closeSummary(workspaceId: string, sprintId: string): Promise<SprintCloseSummary> {
    const sprint = await this.prisma.forSystem().sprint.findUnique({
      where: { id: sprintId },
    });
    if (!sprint || sprint.workspaceId !== workspaceId) {
      throw new NotFoundException('Sprint not found');
    }
    return this.buildCloseSummary(this.prisma.forSystem(), sprintId);
  }

  /**
   * Computes the sprint-close summary strictly from `SprintTaskSnapshot`
   * rows (PRD FR-19): scope from START snapshots, delivered from COMPLETE
   * snapshots where status = DONE, slipped = scope − delivered.
   * `velocity` = deliveredEstimate (points-based per techspec).
   */
  private async buildCloseSummary(
    client: PrismaTx | ReturnType<PrismaService['forSystem']>,
    sprintId: string,
  ): Promise<SprintCloseSummary> {
    const [starts, completes] = await Promise.all([
      client.sprintTaskSnapshot.findMany({
        where: { sprintId, phase: 'START' },
        select: { taskId: true, estimate: true },
      }),
      client.sprintTaskSnapshot.findMany({
        where: { sprintId, phase: 'COMPLETE' },
        select: { taskId: true, estimate: true, status: true },
      }),
    ]);

    const plannedCount = starts.length;
    const plannedEstimate = sumEstimate(starts);

    const deliveredRows = completes.filter((c) => c.status === 'DONE');
    const deliveredCount = deliveredRows.length;
    const deliveredEstimate = sumEstimate(deliveredRows);

    const deliveredIds = new Set(deliveredRows.map((c) => c.taskId));
    const slippedRows = starts.filter((s) => !deliveredIds.has(s.taskId));
    const slippedCount = slippedRows.length;
    const slippedEstimate = sumEstimate(slippedRows);
    const slippedTaskIds = slippedRows.map((s) => s.taskId);

    return {
      sprintId,
      plannedCount,
      plannedEstimate,
      deliveredCount,
      deliveredEstimate,
      slippedCount,
      slippedEstimate,
      velocity: deliveredEstimate,
      slippedTaskIds,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async claimNextNumber(tx: PrismaTx, projectId: string): Promise<number> {
    // MAX(number)+1 under advisory lock so concurrent creators serialise
    // instead of racing to the same (projectId, number) unique.
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      `sprint-seq:${projectId}`,
    );
    const last = await tx.sprint.findFirst({
      where: { projectId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return (last?.number ?? 0) + 1;
  }
}

function sumEstimate(rows: Array<{ estimate: number | null }>): number {
  return rows.reduce((acc, row) => acc + (row.estimate ?? 0), 0);
}

function isActiveSprintConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray((err.meta as { target?: string[] } | undefined)?.target) &&
    (err.meta as { target: string[] }).target.some((t) => t.toLowerCase().includes('active'))
  );
}

function activeSprintExistsError(projectId: string): ConflictException {
  return new ConflictException({
    type: 'https://tasker.dev/problems/sprint-active-exists',
    title: 'Another sprint is already active',
    detail: `Project ${projectId} already has an Active sprint. Complete it before starting another.`,
    status: 409,
  });
}

function sprintNotPlannedError(): BadRequestException {
  return new BadRequestException({
    type: 'https://tasker.dev/problems/sprint-not-planned',
    title: 'Sprint is not in Planned state',
    detail: 'Only Planned sprints can be edited.',
    status: 400,
  });
}

function sprintNotActiveError(): BadRequestException {
  return new BadRequestException({
    type: 'https://tasker.dev/problems/sprint-not-active',
    title: 'Sprint is not in Active state',
    detail: 'Only Active sprints can be completed.',
    status: 400,
  });
}

function sprintClosedError(): BadRequestException {
  return new BadRequestException({
    type: 'https://tasker.dev/problems/sprint-closed',
    title: 'Sprint is closed',
    detail: 'A completed sprint cannot be started again.',
    status: 400,
  });
}

function sprintDateOrderError(): BadRequestException {
  return new BadRequestException({
    type: 'https://tasker.dev/problems/sprint-date-order',
    title: 'endDate must be greater than or equal to startDate',
    detail: 'Sprint dates must be in ascending order.',
    status: 400,
  });
}
