import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, SprintState } from '@prisma/client';
import { SprintsService } from './sprints.service';
import { SprintSnapshotService } from './sprint-snapshot.service';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface FakeSprint {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  name: string;
  state: SprintState;
  startDate: Date;
  endDate: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface FakeSnapshot {
  sprintId: string;
  taskId: string;
  phase: 'START' | 'COMPLETE';
  status: string;
  estimate: number | null;
}

function makeFakeTx(state: { sprints: Map<string, FakeSprint>; snapshots: FakeSnapshot[] }) {
  const tx = {
    sprint: {
      findUnique: vi.fn(
        async (args: {
          where: { id?: string; projectId_number?: { projectId: string; number: number } };
        }) => {
          if (args.where.id) return state.sprints.get(args.where.id) ?? null;
          if (args.where.projectId_number) {
            const { projectId, number } = args.where.projectId_number;
            for (const s of state.sprints.values()) {
              if (s.projectId === projectId && s.number === number) return s;
            }
          }
          return null;
        },
      ),
      findFirst: vi.fn(async () => {
        // Return latest sprint by number for claimNextNumber
        const list = [...state.sprints.values()].sort((a, b) => b.number - a.number);
        return list[0] ?? null;
      }),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<FakeSprint, 'startedAt' | 'completedAt' | 'state'> & { state?: SprintState };
        }) => {
          const created: FakeSprint = {
            id: `sp-${data.number}`,
            state: data.state ?? SprintState.PLANNED,
            startedAt: null,
            completedAt: null,
            ...data,
          } as FakeSprint;
          state.sprints.set(created.id, created);
          return created;
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<FakeSprint> }) => {
          const existing = state.sprints.get(where.id);
          if (!existing) throw new Error('sprint missing');
          const next = { ...existing, ...data };
          state.sprints.set(next.id, next);
          return next;
        },
      ),
      findUniqueOrThrow: vi.fn(
        async ({ where, select }: { where: { id: string }; select?: { projectId: true } }) => {
          const s = state.sprints.get(where.id);
          if (!s) throw new Error('sprint missing');
          return select?.projectId ? { projectId: s.projectId } : s;
        },
      ),
    },
    task: {
      findMany: vi.fn(async () => []),
    },
    sprintTaskSnapshot: {
      findMany: vi.fn(
        async ({ where }: { where: { sprintId: string; phase: 'START' | 'COMPLETE' } }) =>
          state.snapshots.filter((s) => s.sprintId === where.sprintId && s.phase === where.phase),
      ),
      createMany: vi.fn(async ({ data }: { data: FakeSnapshot[] }) => {
        state.snapshots.push(...data);
        return { count: data.length };
      }),
    },
    activity: {
      create: vi.fn(async () => ({ id: 'act-1' })),
    },
    $executeRawUnsafe: vi.fn(async () => 0),
  };
  return tx;
}

function makePrisma(state: ReturnType<typeof makeState>) {
  const tx = makeFakeTx(state);
  return {
    forSystem: () => ({
      sprint: tx.sprint,
      sprintTaskSnapshot: tx.sprintTaskSnapshot,
      $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
    }),
    _tx: tx,
  };
}

function makeState() {
  return { sprints: new Map<string, FakeSprint>(), snapshots: [] as FakeSnapshot[] };
}

function makeActivity() {
  return {
    record: vi.fn(async () => ({ id: 'act-1' })),
  };
}

function makeSnapshotService(state: ReturnType<typeof makeState>) {
  return {
    captureOnStart: vi.fn(async (_tx: unknown, sprintId: string) => {
      state.snapshots.push({
        sprintId,
        taskId: 't-1',
        phase: 'START',
        status: 'TODO',
        estimate: 3,
      });
    }),
    captureOnComplete: vi.fn(async (_tx: unknown, sprintId: string) => {
      state.snapshots.push({
        sprintId,
        taskId: 't-1',
        phase: 'COMPLETE',
        status: 'DONE',
        estimate: 3,
      });
    }),
  } satisfies Partial<SprintSnapshotService>;
}

function makeEvents() {
  return { emit: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SprintsService', () => {
  let state: ReturnType<typeof makeState>;
  let prisma: ReturnType<typeof makePrisma>;
  let activity: ReturnType<typeof makeActivity>;
  let snapshots: ReturnType<typeof makeSnapshotService>;
  let events: ReturnType<typeof makeEvents>;
  let service: SprintsService;

  beforeEach(() => {
    state = makeState();
    prisma = makePrisma(state);
    activity = makeActivity();
    snapshots = makeSnapshotService(state);
    events = makeEvents();
    service = new SprintsService(
      prisma as never,
      activity as never,
      snapshots as never,
      events as never,
    );
  });

  it('create rejects when startDate is after endDate', async () => {
    await expect(
      service.create({
        workspaceId: 'ws-1',
        projectId: 'p-1',
        name: 'Bad dates',
        startDate: '2026-07-14',
        endDate: '2026-07-01',
        actorUserId: 'u-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create emits sprint.created activity + event', async () => {
    const sprint = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      name: 'Sprint 1',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      actorUserId: 'u-1',
    });
    expect(sprint.state).toBe(SprintState.PLANNED);
    expect(activity.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'sprint.created' }),
    );
    expect(events.emit).toHaveBeenCalledWith('sprint.created', expect.anything());
  });

  it('start transitions PLANNED → ACTIVE and captures the START snapshot', async () => {
    const created = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      name: 'Sprint 1',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      actorUserId: 'u-1',
    });

    const started = await service.start('ws-1', created.id, 'u-1');
    expect(started.state).toBe(SprintState.ACTIVE);
    expect(snapshots.captureOnStart).toHaveBeenCalledWith(expect.anything(), created.id);
    expect(activity.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'sprint.started' }),
    );
  });

  it('start is idempotent on an already-Active sprint', async () => {
    const created = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      name: 'Sprint 1',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      actorUserId: 'u-1',
    });
    await service.start('ws-1', created.id, 'u-1');
    const startedActivityCallsBefore = activity.record.mock.calls.length;
    const second = await service.start('ws-1', created.id, 'u-1');
    expect(second.state).toBe(SprintState.ACTIVE);
    // No new snapshot or activity on the replay.
    expect(activity.record.mock.calls.length).toBe(startedActivityCallsBefore);
    expect(snapshots.captureOnStart).toHaveBeenCalledTimes(1);
  });

  it('start blocks a Completed sprint from re-starting', async () => {
    const created = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      name: 'Sprint 1',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      actorUserId: 'u-1',
    });
    await service.start('ws-1', created.id, 'u-1');
    await service.complete('ws-1', created.id, 'u-1');
    await expect(service.start('ws-1', created.id, 'u-1')).rejects.toThrow(BadRequestException);
  });

  it('start surfaces 409 when the partial unique index rejects a second Active sprint', async () => {
    const created = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      name: 'Sprint 1',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      actorUserId: 'u-1',
    });

    prisma._tx.sprint.update.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: '6',
        meta: { target: ['Sprint_projectId_active_key'] },
      });
    });

    await expect(service.start('ws-1', created.id, 'u-1')).rejects.toThrow(ConflictException);
  });

  it('complete transitions ACTIVE → COMPLETED, captures snapshot, returns summary', async () => {
    const created = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      name: 'Sprint 1',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      actorUserId: 'u-1',
    });
    await service.start('ws-1', created.id, 'u-1');

    const summary = await service.complete('ws-1', created.id, 'u-1');
    expect(summary.deliveredCount).toBe(1);
    expect(summary.slippedCount).toBe(0);
    expect(summary.velocity).toBe(3);
    expect(snapshots.captureOnComplete).toHaveBeenCalledWith(expect.anything(), created.id);
  });

  it('complete is idempotent — replays return the frozen summary', async () => {
    const created = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      name: 'Sprint 1',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      actorUserId: 'u-1',
    });
    await service.start('ws-1', created.id, 'u-1');
    const first = await service.complete('ws-1', created.id, 'u-1');
    const replay = await service.complete('ws-1', created.id, 'u-1');
    expect(replay).toEqual(first);
    // captureOnComplete was called exactly once — the replay is a no-op.
    expect(snapshots.captureOnComplete).toHaveBeenCalledTimes(1);
  });

  it('update rejects when the sprint is not Planned', async () => {
    const created = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      name: 'Sprint 1',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      actorUserId: 'u-1',
    });
    await service.start('ws-1', created.id, 'u-1');
    await expect(service.update('ws-1', created.id, { name: 'Renamed' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('findByNumber returns null when the workspace does not match', async () => {
    await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      name: 'Sprint 1',
      startDate: '2026-07-01',
      endDate: '2026-07-14',
      actorUserId: 'u-1',
    });
    expect(await service.findByNumber('ws-2', 'p-1', 1)).toBeNull();
  });

  it('closeSummary throws NotFound for unknown sprint', async () => {
    await expect(service.closeSummary('ws-1', 'missing')).rejects.toThrow(NotFoundException);
  });
});
