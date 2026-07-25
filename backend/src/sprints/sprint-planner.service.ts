import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SprintState } from '@prisma/client';
import type { ActivityVerb } from '@tasker/config';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/activity/activity.service';
import { SprintEvents, SprintTasksMutatedEvent } from './events/sprint.events';

export interface AddRemoveTasksInput {
  workspaceId: string;
  projectId: string;
  sprintId: string;
  add: string[];
  remove: string[];
  actorUserId: string;
}

export interface CapacityEntry {
  memberUserId: string;
  capacityPoints: number;
}

export interface UpsertCapacityInput {
  workspaceId: string;
  sprintId: string;
  entries: CapacityEntry[];
}

/**
 * Sprint-scoped planner operations: batched backlog↔sprint moves and
 * per-member capacity upserts.
 *
 * The service enforces the PRD invariants that the DB layer cannot express:
 *   - FR-4: a task is never in more than one Active sprint across the
 *     workspace.
 *   - FR-3: only PLANNED or ACTIVE sprints accept task moves.
 *   - tasks moved into a sprint must belong to the same project.
 *
 * Every mutation runs inside a single Postgres transaction so a partial
 * failure never leaves the sprint in a half-mutated state, and the activity
 * emission commits with it.
 */
@Injectable()
export class SprintPlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly events: EventEmitter2,
  ) {}

  async addRemoveTasks(input: AddRemoveTasksInput): Promise<void> {
    // Empty payload is a no-op — the DTO guarantees at least one side is set,
    // but keep the defensive check so an internal caller can't accidentally
    // emit a phantom activity row.
    if (input.add.length === 0 && input.remove.length === 0) return;

    await this.prisma.forSystem().$transaction(async (tx) => {
      const sprint = await tx.sprint.findUnique({
        where: { id: input.sprintId },
        select: {
          id: true,
          workspaceId: true,
          projectId: true,
          state: true,
        },
      });
      if (!sprint || sprint.workspaceId !== input.workspaceId) {
        throw new NotFoundException('Sprint not found');
      }
      if (sprint.projectId !== input.projectId) {
        throw new NotFoundException('Sprint does not belong to this project');
      }
      if (sprint.state === SprintState.COMPLETED) {
        throw sprintClosedError();
      }

      if (input.add.length > 0) {
        const tasks = await tx.task.findMany({
          where: {
            id: { in: input.add },
            workspaceId: input.workspaceId,
            deletedAt: null,
          },
          select: {
            id: true,
            projectId: true,
            sprintId: true,
            sprint: { select: { state: true } },
          },
        });
        if (tasks.length !== input.add.length) {
          throw new NotFoundException('One or more tasks not found');
        }
        for (const task of tasks) {
          if (task.projectId !== sprint.projectId) {
            throw wrongProjectError(task.id);
          }
          // FR-4: cannot move a task into a new Active sprint while it is
          // already in another Active sprint.
          if (
            task.sprintId &&
            task.sprintId !== sprint.id &&
            task.sprint?.state === SprintState.ACTIVE
          ) {
            throw taskAlreadyInActiveSprintError(task.id);
          }
        }

        await tx.task.updateMany({
          where: { id: { in: input.add } },
          data: { sprintId: sprint.id },
        });
      }

      if (input.remove.length > 0) {
        await tx.task.updateMany({
          where: {
            id: { in: input.remove },
            sprintId: sprint.id,
          },
          data: { sprintId: null },
        });
      }

      const verbs: Array<{ verb: ActivityVerb; ids: string[] }> = [
        { verb: 'sprint.task_added', ids: input.add },
        { verb: 'sprint.task_removed', ids: input.remove },
      ];
      for (const { verb, ids } of verbs) {
        for (const taskId of ids) {
          await this.activity.record(tx, {
            workspaceId: sprint.workspaceId,
            projectId: sprint.projectId,
            taskId,
            actorUserId: input.actorUserId,
            verb,
            payload: {},
          });
        }
      }
    });

    this.events.emit(SprintEvents.TASKS_MUTATED, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sprintId: input.sprintId,
      actorUserId: input.actorUserId,
      added: input.add,
      removed: input.remove,
    } satisfies SprintTasksMutatedEvent);
  }

  async upsertCapacity(input: UpsertCapacityInput): Promise<void> {
    if (input.entries.length === 0) return;

    await this.prisma.forSystem().$transaction(async (tx) => {
      const sprint = await tx.sprint.findUnique({
        where: { id: input.sprintId },
        select: { id: true, workspaceId: true },
      });
      if (!sprint || sprint.workspaceId !== input.workspaceId) {
        throw new NotFoundException('Sprint not found');
      }

      // Verify every user is a member of this workspace. Skips the round-trip
      // when the entries list is empty (defensively guarded above).
      const memberIds = input.entries.map((e) => e.memberUserId);
      const members = await tx.workspaceMember.findMany({
        where: {
          workspaceId: input.workspaceId,
          userId: { in: memberIds },
        },
        select: { userId: true },
      });
      const memberSet = new Set(members.map((m) => m.userId));
      for (const id of memberIds) {
        if (!memberSet.has(id)) throw notWorkspaceMemberError(id);
      }

      for (const entry of input.entries) {
        await tx.sprintCapacity.upsert({
          where: {
            sprintId_memberUserId: {
              sprintId: sprint.id,
              memberUserId: entry.memberUserId,
            },
          },
          create: {
            workspaceId: input.workspaceId,
            sprintId: sprint.id,
            memberUserId: entry.memberUserId,
            capacityPoints: entry.capacityPoints,
          },
          update: {
            capacityPoints: entry.capacityPoints,
          },
        });
      }
    });
  }
}

function sprintClosedError(): BadRequestException {
  return new BadRequestException({
    type: 'https://tasker.dev/problems/sprint-closed',
    title: 'Sprint is closed',
    detail: 'Tasks cannot be added to or removed from a completed sprint.',
    status: 400,
  });
}

function wrongProjectError(taskId: string): BadRequestException {
  return new BadRequestException({
    type: 'https://tasker.dev/problems/sprint-task-wrong-project',
    title: 'Task belongs to a different project',
    detail: `Task ${taskId} cannot be added — sprints are scoped to a single project.`,
    status: 400,
  });
}

function taskAlreadyInActiveSprintError(taskId: string): ConflictException {
  return new ConflictException({
    type: 'https://tasker.dev/problems/task-in-active-sprint',
    title: 'Task is already in another active sprint',
    detail: `Task ${taskId} is currently in an Active sprint. Remove it there first, or complete that sprint.`,
    status: 409,
  });
}

function notWorkspaceMemberError(userId: string): BadRequestException {
  return new BadRequestException({
    type: 'https://tasker.dev/problems/not-workspace-member',
    title: 'User is not a workspace member',
    detail: `User ${userId} is not a member of this workspace and cannot have a sprint capacity.`,
    status: 400,
  });
}
