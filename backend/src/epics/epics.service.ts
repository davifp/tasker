import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Epic, EpicStatus, Prisma } from '@prisma/client';
import { QUARTER_ID_REGEXP } from '@tasker/config';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/activity/activity.service';

type PrismaTx = Prisma.TransactionClient;

export interface CreateEpicInput {
  workspaceId: string;
  projectId: string;
  title: string;
  description?: string;
  status?: EpicStatus;
  startQuarter: string;
  endQuarter: string;
  actorUserId: string;
}

export interface UpdateEpicPatch {
  title?: string;
  description?: string | null;
  status?: EpicStatus;
  startQuarter?: string;
  endQuarter?: string;
}

export interface RoadmapQueryInput {
  workspaceId: string;
  fromQuarter?: string;
  toQuarter?: string;
  projectId?: string;
}

@Injectable()
export class EpicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async create(input: CreateEpicInput): Promise<Epic> {
    assertQuarterOrder(input.startQuarter, input.endQuarter);

    return this.prisma.forSystem().$transaction(async (tx) => {
      const epic = await tx.epic.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          status: input.status ?? EpicStatus.PLANNED,
          startQuarter: input.startQuarter,
          endQuarter: input.endQuarter,
          createdByUserId: input.actorUserId,
        },
      });

      await this.activity.record(tx, {
        workspaceId: epic.workspaceId,
        projectId: epic.projectId,
        actorUserId: input.actorUserId,
        verb: 'epic.created',
        payload: { targetTitle: epic.title },
      });

      return epic;
    });
  }

  async update(
    workspaceId: string,
    epicId: string,
    patch: UpdateEpicPatch,
    actorUserId: string,
  ): Promise<Epic> {
    return this.prisma.forSystem().$transaction(async (tx) => {
      const existing = await tx.epic.findUnique({ where: { id: epicId } });
      if (!existing || existing.workspaceId !== workspaceId || existing.deletedAt) {
        throw new NotFoundException('Epic not found');
      }

      const nextStart = patch.startQuarter ?? existing.startQuarter;
      const nextEnd = patch.endQuarter ?? existing.endQuarter;
      assertQuarterOrder(nextStart, nextEnd);

      const updated = await tx.epic.update({
        where: { id: epicId },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.startQuarter !== undefined ? { startQuarter: patch.startQuarter } : {}),
          ...(patch.endQuarter !== undefined ? { endQuarter: patch.endQuarter } : {}),
        },
      });

      await this.activity.record(tx, {
        workspaceId: updated.workspaceId,
        projectId: updated.projectId,
        actorUserId,
        verb: 'epic.updated',
        payload: { targetTitle: updated.title },
      });

      return updated;
    });
  }

  async softDelete(workspaceId: string, epicId: string, actorUserId: string): Promise<Epic> {
    return this.prisma.forSystem().$transaction(async (tx) => {
      const existing = await tx.epic.findUnique({ where: { id: epicId } });
      if (!existing || existing.workspaceId !== workspaceId || existing.deletedAt) {
        throw new NotFoundException('Epic not found');
      }

      const updated = await tx.epic.update({
        where: { id: epicId },
        data: { deletedAt: new Date() },
      });

      // FR-22 explicit: unlinking (or here, soft-deleting the epic) MUST NOT
      // delete the tasks. `Task.epicId` is kept intact so that if an Admin
      // restores the epic, the links come back with it. `epic.deleted`
      // Activity announces the intent for the audit trail.
      await this.activity.record(tx, {
        workspaceId: updated.workspaceId,
        projectId: updated.projectId,
        actorUserId,
        verb: 'epic.deleted',
        payload: { targetTitle: updated.title },
      });

      return updated;
    });
  }

  async linkTask(workspaceId: string, epicId: string, taskId: string): Promise<void> {
    await this.prisma.forSystem().$transaction(async (tx) => {
      const epic = await this.requireLiveEpic(tx, workspaceId, epicId);
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: { id: true, workspaceId: true, projectId: true, deletedAt: true },
      });
      if (!task || task.workspaceId !== workspaceId || task.deletedAt) {
        throw new NotFoundException('Task not found');
      }
      if (task.projectId !== epic.projectId) {
        throw wrongProjectError();
      }

      await tx.task.update({
        where: { id: taskId },
        data: { epicId },
      });
    });
  }

  async unlinkTask(workspaceId: string, epicId: string, taskId: string): Promise<void> {
    await this.prisma.forSystem().$transaction(async (tx) => {
      await this.requireLiveEpic(tx, workspaceId, epicId);
      const result = await tx.task.updateMany({
        where: { id: taskId, workspaceId, epicId },
        data: { epicId: null },
      });
      if (result.count === 0) {
        throw new NotFoundException('Task is not linked to this epic');
      }
    });
  }

  async roadmap(input: RoadmapQueryInput): Promise<Epic[]> {
    const where: Prisma.EpicWhereInput = {
      workspaceId: input.workspaceId,
      deletedAt: null,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    };

    if (input.fromQuarter || input.toQuarter) {
      const filters: Prisma.EpicWhereInput[] = [];
      if (input.toQuarter) {
        // An epic overlaps the window when its start is at or before the
        // window's end.
        filters.push({ startQuarter: { lte: input.toQuarter } });
      }
      if (input.fromQuarter) {
        filters.push({ endQuarter: { gte: input.fromQuarter } });
      }
      where.AND = filters;
    }

    return this.prisma.forSystem().epic.findMany({
      where,
      orderBy: [{ startQuarter: 'asc' }, { id: 'asc' }],
    });
  }

  private async requireLiveEpic(tx: PrismaTx, workspaceId: string, epicId: string): Promise<Epic> {
    const epic = await tx.epic.findUnique({ where: { id: epicId } });
    if (!epic || epic.workspaceId !== workspaceId || epic.deletedAt) {
      throw new NotFoundException('Epic not found');
    }
    return epic;
  }
}

function assertQuarterOrder(start: string, end: string): void {
  if (!QUARTER_ID_REGEXP.test(start) || !QUARTER_ID_REGEXP.test(end)) {
    throw new BadRequestException({
      type: 'https://tasker.dev/problems/invalid-quarter-id',
      title: 'Invalid quarter identifier',
      detail: 'Quarter must match YYYY-Qn.',
      status: 400,
    });
  }
  if (quarterOrdinal(end) < quarterOrdinal(start)) {
    throw new BadRequestException({
      type: 'https://tasker.dev/problems/epic-quarter-order',
      title: 'endQuarter must be greater than or equal to startQuarter',
      detail: 'An epic cannot end before it starts.',
      status: 400,
    });
  }
}

function quarterOrdinal(q: string): number {
  const [year, part] = q.split('-Q');
  return Number(year) * 4 + Number(part);
}

function wrongProjectError(): BadRequestException {
  return new BadRequestException({
    type: 'https://tasker.dev/problems/epic-task-wrong-project',
    title: 'Task belongs to a different project',
    detail: 'Epics can only link tasks that live in the same project.',
    status: 400,
  });
}
