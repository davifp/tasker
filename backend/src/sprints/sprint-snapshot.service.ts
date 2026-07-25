import { Injectable } from '@nestjs/common';
import { Prisma, SprintSnapshotPhase } from '@prisma/client';

type PrismaTx = Prisma.TransactionClient;

/**
 * Writes immutable `SprintTaskSnapshot` rows at each sprint lifecycle
 * boundary (PRD FR-9, FR-10). Every call runs inside a caller-supplied
 * transaction so the snapshot commits atomically with the lifecycle
 * transition — a torn write would let velocity/burndown drift.
 *
 * Idempotency: the `(sprintId, taskId, phase)` unique index catches any
 * accidental double-capture. This service uses `createMany({ skipDuplicates
 * : true })` so a replay of `POST /sprints/:n/start` (retry storm,
 * Idempotency-Key hit) is a no-op instead of a 500.
 */
@Injectable()
export class SprintSnapshotService {
  /**
   * Snapshot every task currently attached to the sprint. Called from
   * `SprintsService.start` inside the state-transition transaction.
   */
  async captureOnStart(tx: PrismaTx, sprintId: string): Promise<void> {
    return this.capture(tx, sprintId, SprintSnapshotPhase.START);
  }

  /**
   * Snapshot the final state of every task in the sprint. Called from
   * `SprintsService.complete` inside the state-transition transaction.
   */
  async captureOnComplete(tx: PrismaTx, sprintId: string): Promise<void> {
    return this.capture(tx, sprintId, SprintSnapshotPhase.COMPLETE);
  }

  private async capture(tx: PrismaTx, sprintId: string, phase: SprintSnapshotPhase): Promise<void> {
    const sprint = await tx.sprint.findUnique({
      where: { id: sprintId },
      select: { workspaceId: true },
    });
    if (!sprint) return;

    const tasks = await tx.task.findMany({
      where: { sprintId, deletedAt: null },
      select: {
        id: true,
        status: true,
        estimate: true,
        assigneeUserId: true,
      },
    });

    if (tasks.length === 0) return;

    await tx.sprintTaskSnapshot.createMany({
      skipDuplicates: true,
      data: tasks.map((t) => ({
        workspaceId: sprint.workspaceId,
        sprintId,
        taskId: t.id,
        phase,
        status: t.status,
        estimate: t.estimate,
        assigneeUserId: t.assigneeUserId,
      })),
    });
  }
}
