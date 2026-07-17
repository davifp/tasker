import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, Task, TaskStatus, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Positions } from '../common/ordering/positions';
import {
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskEvents,
  TaskMovedEvent,
  TaskRestoredEvent,
  TaskUpdatedEvent,
} from './events/task.events';

const SOFT_DELETE_WINDOW_DAYS = 30;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const POSITION_RETRY_LIMIT = 1;

type PrismaTx = Prisma.TransactionClient;

export interface CreateTaskInput {
  workspaceId: string;
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  assigneeUserId?: string;
  dueDate?: string;
  labelIds?: string[];
  actorUserId: string;
}

export interface UpdateTaskPatch {
  title?: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  assigneeUserId?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
}

export interface MoveTaskInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  status: TaskStatus;
  position: string;
  ifUnchangedSince: Date;
  actorUserId: string;
  overrideBlockers?: boolean;
}

export type MoveTaskResult =
  | { kind: 'moved'; task: Task }
  | { kind: 'blocked'; task: Task; acknowledgedBlockersOpen: string[] };

export interface ListTasksFilters {
  cursor?: string;
  limit?: number;
  status?: TaskStatus;
  assigneeUserId?: string;
  labelId?: string;
  includeDeleted?: boolean;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async create(input: CreateTaskInput): Promise<Task> {
    const targetStatus = input.status ?? TaskStatus.BACKLOG;

    // Claim number FIRST so the ProjectSequence row lock serialises concurrent
    // creators; only after we hold it do we read the tail position (now
    // reflecting other committed inserts) and generate a fresh key. This
    // ordering prevents two concurrent creators from computing the same
    // fractional-index key from the same stale tail snapshot.
    for (let attempt = 0; attempt <= POSITION_RETRY_LIMIT; attempt++) {
      try {
        const task = await this.prisma.forSystem().$transaction(async (tx) => {
          const number = await this.claimNextNumber(tx, input.projectId);
          const tail = await this.readTailPosition(tx, input.projectId, targetStatus);
          const position = Positions.between(tail, null);

          const created = await tx.task.create({
            data: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              number,
              title: input.title,
              description: input.description ?? '',
              status: targetStatus,
              priority: input.priority ?? 'MEDIUM',
              position,
              assigneeUserId: input.assigneeUserId,
              createdByUserId: input.actorUserId,
              dueDate: input.dueDate ? new Date(input.dueDate) : null,
              ...(input.labelIds && input.labelIds.length > 0
                ? { labels: { create: input.labelIds.map((labelId) => ({ labelId })) } }
                : {}),
            },
          });

          return created;
        });

        this.events.emit(TaskEvents.CREATED, {
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          number: task.number,
          actorUserId: input.actorUserId,
        } satisfies TaskCreatedEvent);

        return task;
      } catch (err) {
        if (attempt < POSITION_RETRY_LIMIT && isPositionConflict(err)) continue;
        if (isPositionConflict(err)) throw positionConflictError();
        throw err;
      }
    }

    throw positionConflictError();
  }

  async findByNumber(
    workspaceId: string,
    projectId: string,
    number: number,
    includeDeleted = false,
  ): Promise<Task | null> {
    const task = await this.prisma.forSystem().task.findUnique({
      where: { projectId_number: { projectId, number } },
    });
    if (!task) return null;
    if (task.workspaceId !== workspaceId) return null;
    if (task.deletedAt && !includeDeleted) return null;
    return task;
  }

  async update(
    workspaceId: string,
    taskId: string,
    patch: UpdateTaskPatch,
    actorUserId: string,
  ): Promise<Task> {
    // labelIds → full replace of TaskLabel rows
    const { labelIds, ...scalarPatch } = patch;
    const task = await this.prisma.forSystem().$transaction(async (tx) => {
      const existing = await tx.task.findUnique({ where: { id: taskId } });
      if (!existing || existing.workspaceId !== workspaceId) {
        throw new NotFoundException('Task not found');
      }

      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          ...(scalarPatch.title !== undefined ? { title: scalarPatch.title } : {}),
          ...(scalarPatch.description !== undefined
            ? { description: scalarPatch.description }
            : {}),
          ...(scalarPatch.priority !== undefined ? { priority: scalarPatch.priority } : {}),
          ...(scalarPatch.assigneeUserId !== undefined
            ? { assigneeUserId: scalarPatch.assigneeUserId }
            : {}),
          ...(scalarPatch.dueDate !== undefined
            ? { dueDate: scalarPatch.dueDate ? new Date(scalarPatch.dueDate) : null }
            : {}),
        },
      });

      if (labelIds !== undefined) {
        await tx.taskLabel.deleteMany({ where: { taskId } });
        if (labelIds.length > 0) {
          await tx.taskLabel.createMany({
            data: labelIds.map((labelId) => ({ taskId, labelId })),
            skipDuplicates: true,
          });
        }
      }

      return updated;
    });

    this.events.emit(TaskEvents.UPDATED, {
      workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      actorUserId,
    } satisfies TaskUpdatedEvent);

    return task;
  }

  async move(input: MoveTaskInput): Promise<MoveTaskResult> {
    const result = await this.prisma.forSystem().$transaction(async (tx) => {
      // Per-column advisory lock: concurrent movers targeting the same
      // (project, status) column serialise on this key. Different columns
      // proceed in parallel. Released automatically at tx commit/rollback.
      await this.acquireColumnLock(tx, input.projectId, input.status);

      const existing = await tx.task.findUnique({ where: { id: input.taskId } });
      if (
        !existing ||
        existing.workspaceId !== input.workspaceId ||
        existing.deletedAt !== null
      ) {
        throw new NotFoundException('Task not found');
      }

      // Optimistic concurrency: reject if the row has been updated since
      // the caller last saw it.
      if (existing.updatedAt.getTime() !== input.ifUnchangedSince.getTime()) {
        throw staleWriteError();
      }

      // DONE-transition blocker gate. If any blocker isn't itself DONE and
      // the caller hasn't opted in via overrideBlockers, surface the open
      // blocker WEB-<n> identifiers so the client can show the confirmation
      // and retry with overrideBlockers=true. Skip the DB probe entirely
      // when the caller has already opted to override — saves a round trip
      // on the frequent "yes, close it anyway" path.
      if (
        input.status === 'DONE' &&
        existing.status !== 'DONE' &&
        input.overrideBlockers !== true
      ) {
        const openBlockers = await this.readOpenBlockers(tx, input.taskId);
        if (openBlockers.length > 0) {
          return { kind: 'blocked' as const, task: existing, openBlockers };
        }
      }

      // Under the column lock we exclusively see committed writes to this
      // (projectId, status) slot. If the caller's requested key is already
      // taken by a live sibling, regenerate from the current tail; the
      // partial unique index would otherwise refuse the update.
      let position = input.position;
      const collision = await tx.task.findFirst({
        where: {
          projectId: input.projectId,
          status: input.status,
          position: input.position,
          deletedAt: null,
          id: { not: input.taskId },
        },
        select: { id: true },
      });
      if (collision) {
        const tail = await this.readTailPosition(tx, input.projectId, input.status);
        position = Positions.between(tail, null);
      }

      const fromStatus = existing.status;
      const updated = await tx.task.update({
        where: { id: input.taskId },
        data: { status: input.status, position },
      });
      return { kind: 'moved' as const, updated, fromStatus };
    });

    if (result.kind === 'blocked') {
      return {
        kind: 'blocked',
        task: result.task,
        acknowledgedBlockersOpen: result.openBlockers,
      };
    }

    this.events.emit(TaskEvents.MOVED, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: result.updated.id,
      actorUserId: input.actorUserId,
      fromStatus: result.fromStatus,
      toStatus: result.updated.status,
    } satisfies TaskMovedEvent);

    return { kind: 'moved', task: result.updated };
  }

  private async readOpenBlockers(tx: PrismaTx, taskId: string): Promise<string[]> {
    const rows = await tx.taskDependency.findMany({
      where: { taskId, blockedBy: { status: { not: 'DONE' }, deletedAt: null } },
      select: { blockedBy: { select: { number: true, project: { select: { slug: true } } } } },
    });
    return rows.map((r) => `${r.blockedBy.project.slug}-${r.blockedBy.number}`);
  }

  async softDelete(params: {
    workspaceId: string;
    taskId: string;
    actorUserId: string;
    actorRole: WorkspaceRole;
  }): Promise<Task> {
    const existing = await this.prisma.forSystem().task.findUnique({
      where: { id: params.taskId },
    });
    if (!existing || existing.workspaceId !== params.workspaceId) {
      throw new NotFoundException('Task not found');
    }
    if (existing.deletedAt) {
      throw new BadRequestException('Task is already deleted');
    }

    this.assertCanDelete(existing.createdByUserId, params.actorUserId, params.actorRole);

    const now = new Date();
    const purgeAt = new Date(now.getTime() + SOFT_DELETE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const task = await this.prisma.forSystem().task.update({
      where: { id: params.taskId },
      data: { deletedAt: now, purgeAt },
    });

    this.events.emit(TaskEvents.DELETED, {
      workspaceId: params.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      actorUserId: params.actorUserId,
      purgeAt,
    } satisfies TaskDeletedEvent);

    return task;
  }

  async restore(params: {
    workspaceId: string;
    taskId: string;
    actorUserId: string;
    actorRole: WorkspaceRole;
  }): Promise<Task> {
    const existing = await this.prisma.forSystem().task.findUnique({
      where: { id: params.taskId },
    });
    if (!existing || existing.workspaceId !== params.workspaceId) {
      throw new NotFoundException('Task not found');
    }
    if (!existing.deletedAt) {
      throw new BadRequestException('Task is not deleted');
    }
    if (existing.purgeAt && existing.purgeAt < new Date()) {
      throw new BadRequestException('Task has already been purged');
    }

    this.assertCanDelete(existing.createdByUserId, params.actorUserId, params.actorRole);

    // The old position may now collide with a live task at the same key. Try
    // the original slot first; on collision, fall back to a fresh tail.
    const runRestore = async (position: string | null): Promise<Task> =>
      this.prisma.forSystem().task.update({
        where: { id: params.taskId },
        data: {
          deletedAt: null,
          purgeAt: null,
          ...(position !== null ? { position } : {}),
        },
      });

    let task: Task;
    try {
      task = await runRestore(null);
    } catch (err) {
      if (!isPositionConflict(err)) throw err;
      const freshTail = await this.readTailPosition(
        this.prisma.forSystem(),
        existing.projectId,
        existing.status,
      );
      task = await runRestore(Positions.between(freshTail, null));
    }

    this.events.emit(TaskEvents.RESTORED, {
      workspaceId: params.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      actorUserId: params.actorUserId,
    } satisfies TaskRestoredEvent);

    return task;
  }

  async listForProject(
    workspaceId: string,
    projectId: string,
    filters: ListTasksFilters = {},
  ): Promise<CursorPage<Task>> {
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const where: Prisma.TaskWhereInput = {
      workspaceId,
      projectId,
      ...(filters.includeDeleted ? {} : { deletedAt: null }),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.assigneeUserId ? { assigneeUserId: filters.assigneeUserId } : {}),
      ...(filters.labelId ? { labels: { some: { labelId: filters.labelId } } } : {}),
    };

    const items = await this.prisma.forSystem().task.findMany({
      where,
      orderBy: [{ status: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async acquireColumnLock(
    tx: PrismaTx,
    projectId: string,
    status: TaskStatus,
  ): Promise<void> {
    // Postgres advisory lock keyed on the (project, status) column identifier.
    // hashtextextended is Postgres 11+; returns bigint. Two movers targeting
    // the same column serialise here — different columns take different locks
    // and stay parallel. Released automatically when the transaction ends.
    const key = `${projectId}:${status}`;
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key);
  }

  private async claimNextNumber(tx: PrismaTx, projectId: string): Promise<number> {
    // Atomic: upsert with post-increment. If created, initial nextNumber=2 so
    // this task gets number=1. If updated, prev+1 is returned; this task
    // number is returnedNextNumber - 1.
    const sequence = await tx.projectSequence.upsert({
      where: { projectId },
      create: { projectId, nextNumber: 2 },
      update: { nextNumber: { increment: 1 } },
    });
    return sequence.nextNumber - 1;
  }

  private async readTailPosition(
    client: PrismaTx | Prisma.TransactionClient | ReturnType<PrismaService['forSystem']>,
    projectId: string,
    status: TaskStatus,
  ): Promise<string | null> {
    const tail = await client.task.findFirst({
      where: { projectId, status, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return tail?.position ?? null;
  }

  private assertCanDelete(
    createdByUserId: string,
    actorUserId: string,
    actorRole: WorkspaceRole,
  ): void {
    if (actorRole === 'OWNER' || actorRole === 'ADMIN') return;
    if (actorRole === 'MEMBER' && createdByUserId === actorUserId) return;
    throw new ForbiddenException({
      type: 'https://tasker.dev/problems/task-delete-forbidden',
      title: 'Only the task creator or an Admin can delete this task',
      detail:
        'Members can delete tasks they created; Admins and Owners can delete any task in the workspace.',
      status: 403,
    });
  }
}

function isPositionConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray((err.meta as { target?: string[] } | undefined)?.target) &&
    (err.meta as { target: string[] }).target.some((t) => t.toLowerCase().includes('position'))
  );
}

function positionConflictError(): ConflictException {
  return new ConflictException({
    type: 'https://tasker.dev/problems/position-conflict',
    title: 'Position slot is taken',
    detail: 'Another concurrent operation claimed the same position; retry with a fresh slot.',
    status: 409,
  });
}

function staleWriteError(): ConflictException {
  return new ConflictException({
    type: 'https://tasker.dev/problems/stale-write',
    title: 'Stale write',
    detail:
      'The task has changed since you last read it. Refresh and retry with the new updatedAt value.',
    status: 409,
  });
}
