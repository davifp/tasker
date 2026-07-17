import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, TaskDependency } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskDependencyAddedEvent, TaskEvents } from '../events/task.events';

type PrismaTx = Prisma.TransactionClient;

export interface AddDependencyInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  blockedByTaskId: string;
  actorUserId: string;
}

export interface RemoveDependencyInput {
  workspaceId: string;
  taskId: string;
  blockedByTaskId: string;
}

@Injectable()
export class TaskDependenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async add(input: AddDependencyInput): Promise<TaskDependency> {
    if (input.taskId === input.blockedByTaskId) {
      throw dependencyCycleError();
    }

    const dependency = await this.prisma.forSystem().$transaction(async (tx) => {
      const [task, blocker] = await Promise.all([
        tx.task.findUnique({
          where: { id: input.taskId },
          select: { workspaceId: true, projectId: true, deletedAt: true },
        }),
        tx.task.findUnique({
          where: { id: input.blockedByTaskId },
          select: { workspaceId: true, projectId: true, deletedAt: true },
        }),
      ]);
      if (!task || task.workspaceId !== input.workspaceId || task.deletedAt !== null) {
        throw new NotFoundException('Task not found');
      }
      if (
        !blocker ||
        blocker.workspaceId !== input.workspaceId ||
        blocker.deletedAt !== null
      ) {
        throw new NotFoundException('Blocker task not found in this workspace');
      }
      if (blocker.projectId !== task.projectId) {
        throw new BadRequestException({
          type: 'https://tasker.dev/problems/dependency-cross-project',
          title: 'Blocker task must belong to the same project',
          status: 400,
        });
      }

      // Cycle detection: walk the blockedBy graph starting from the new
      // blocker; if we can reach the task itself, adding this edge would
      // close a cycle. DFS with a Set is O(V+E) and bounded by the (small)
      // dependency graph of a single project.
      if (await this.wouldFormCycle(tx, input.taskId, input.blockedByTaskId)) {
        throw dependencyCycleError();
      }

      try {
        return await tx.taskDependency.create({
          data: { taskId: input.taskId, blockedByTaskId: input.blockedByTaskId },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException({
            type: 'https://tasker.dev/problems/dependency-exists',
            title: 'Dependency already exists',
            status: 409,
          });
        }
        throw err;
      }
    });

    this.events.emit(TaskEvents.DEPENDENCY_ADDED, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      blockedByTaskId: input.blockedByTaskId,
      actorUserId: input.actorUserId,
    } satisfies TaskDependencyAddedEvent);

    return dependency;
  }

  async remove(input: RemoveDependencyInput): Promise<void> {
    const client = this.prisma.forSystem();
    const task = await client.task.findUnique({
      where: { id: input.taskId },
      select: { workspaceId: true },
    });
    if (!task || task.workspaceId !== input.workspaceId) {
      throw new NotFoundException('Task not found');
    }

    try {
      await client.taskDependency.delete({
        where: {
          taskId_blockedByTaskId: {
            taskId: input.taskId,
            blockedByTaskId: input.blockedByTaskId,
          },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException('Dependency not found');
      }
      throw err;
    }
  }

  async listForTask(workspaceId: string, taskId: string): Promise<TaskDependency[]> {
    const task = await this.prisma.forSystem().task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    if (!task || task.workspaceId !== workspaceId) {
      throw new NotFoundException('Task not found');
    }
    return this.prisma.forSystem().taskDependency.findMany({ where: { taskId } });
  }

  private async wouldFormCycle(
    tx: PrismaTx,
    originTaskId: string,
    blockerTaskId: string,
  ): Promise<boolean> {
    // Adding "origin blockedBy blocker" closes a cycle iff origin is
    // already reachable through blocker's own blockedBy chain — i.e. blocker
    // is (directly or transitively) blocked by origin.
    const visited = new Set<string>();
    const stack: string[] = [blockerTaskId];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (visited.has(current)) continue;
      visited.add(current);
      if (current === originTaskId) return true;

      const edges = await tx.taskDependency.findMany({
        where: { taskId: current },
        select: { blockedByTaskId: true },
      });
      for (const edge of edges) {
        stack.push(edge.blockedByTaskId);
      }
    }
    return false;
  }
}

function dependencyCycleError(): ConflictException {
  return new ConflictException({
    type: 'https://tasker.dev/problems/dependency-cycle',
    title: 'Adding this dependency would create a cycle',
    detail:
      'The blocker task is already (directly or transitively) blocked by this task.',
    status: 409,
  });
}
