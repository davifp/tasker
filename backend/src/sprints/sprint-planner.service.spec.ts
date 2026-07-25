import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SprintState } from '@prisma/client';
import { SprintPlannerService } from './sprint-planner.service';

interface FakeSprint {
  id: string;
  workspaceId: string;
  projectId: string;
  state: SprintState;
}

interface FakeTask {
  id: string;
  projectId: string;
  sprintId: string | null;
  sprintState: SprintState | null;
}

function buildPrisma(state: {
  sprints: Map<string, FakeSprint>;
  tasks: Map<string, FakeTask>;
  members: Set<string>;
}) {
  const tx = {
    sprint: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => state.sprints.get(where.id) ?? null,
      ),
    },
    task: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        return where.id.in
          .map((id) => state.tasks.get(id))
          .filter((t): t is FakeTask => Boolean(t))
          .map((t) => ({
            id: t.id,
            projectId: t.projectId,
            sprintId: t.sprintId,
            sprint: t.sprintState ? { state: t.sprintState } : null,
          }));
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: { in: string[] }; sprintId?: string };
          data: { sprintId: string | null };
        }) => {
          let count = 0;
          for (const [id, task] of state.tasks) {
            const idMatch = where.id?.in?.includes(id) ?? true;
            const sprintMatch = where.sprintId === undefined || task.sprintId === where.sprintId;
            if (idMatch && sprintMatch) {
              state.tasks.set(id, { ...task, sprintId: data.sprintId ?? null });
              count++;
            }
          }
          return { count };
        },
      ),
    },
    workspaceMember: {
      findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in.filter((u) => state.members.has(u)).map((userId) => ({ userId })),
      ),
    },
    sprintCapacity: {
      upsert: vi.fn(async () => ({})),
    },
    activity: { create: vi.fn(async () => ({ id: 'act' })) },
  };
  return {
    forSystem: () => ({
      $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
    }),
    _tx: tx,
  };
}

function makeActivity() {
  return { record: vi.fn(async () => ({ id: 'act' })) };
}

describe('SprintPlannerService — addRemoveTasks', () => {
  const sprintId = 'sp-1';
  let state: {
    sprints: Map<string, FakeSprint>;
    tasks: Map<string, FakeTask>;
    members: Set<string>;
  };
  let prisma: ReturnType<typeof buildPrisma>;
  let activity: ReturnType<typeof makeActivity>;
  let events: { emit: ReturnType<typeof vi.fn> };
  let service: SprintPlannerService;

  beforeEach(() => {
    state = {
      sprints: new Map<string, FakeSprint>([
        [
          sprintId,
          { id: sprintId, workspaceId: 'ws-1', projectId: 'p-1', state: SprintState.PLANNED },
        ],
      ]),
      tasks: new Map<string, FakeTask>([
        ['t-1', { id: 't-1', projectId: 'p-1', sprintId: null, sprintState: null }],
        ['t-2', { id: 't-2', projectId: 'p-1', sprintId: null, sprintState: null }],
        ['t-other', { id: 't-other', projectId: 'p-other', sprintId: null, sprintState: null }],
      ]),
      members: new Set<string>(),
    };
    prisma = buildPrisma(state);
    activity = makeActivity();
    events = { emit: vi.fn() };
    service = new SprintPlannerService(prisma as never, activity as never, events as never);
  });

  it('is a no-op when both add and remove are empty', async () => {
    await service.addRemoveTasks({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      sprintId,
      add: [],
      remove: [],
      actorUserId: 'u-1',
    });
    expect(prisma._tx.task.updateMany).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it('rejects tasks that belong to a different project', async () => {
    await expect(
      service.addRemoveTasks({
        workspaceId: 'ws-1',
        projectId: 'p-1',
        sprintId,
        add: ['t-other'],
        remove: [],
        actorUserId: 'u-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('adds tasks to the sprint and emits sprint.task_added per task', async () => {
    await service.addRemoveTasks({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      sprintId,
      add: ['t-1', 't-2'],
      remove: [],
      actorUserId: 'u-1',
    });
    expect(activity.record).toHaveBeenCalledTimes(2);
    expect(activity.record.mock.calls.every((c) => c[1].verb === 'sprint.task_added')).toBe(true);
    expect(events.emit).toHaveBeenCalledWith(
      'sprint.tasks_mutated',
      expect.objectContaining({ added: ['t-1', 't-2'], removed: [] }),
    );
  });

  it('rejects moving a task into a second Active sprint (FR-4)', async () => {
    // t-1 is already in another Active sprint (sp-other).
    state.sprints.set('sp-other', {
      id: 'sp-other',
      workspaceId: 'ws-1',
      projectId: 'p-1',
      state: SprintState.ACTIVE,
    });
    state.tasks.set('t-1', {
      id: 't-1',
      projectId: 'p-1',
      sprintId: 'sp-other',
      sprintState: SprintState.ACTIVE,
    });

    await expect(
      service.addRemoveTasks({
        workspaceId: 'ws-1',
        projectId: 'p-1',
        sprintId,
        add: ['t-1'],
        remove: [],
        actorUserId: 'u-1',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects mutations against a Completed sprint', async () => {
    state.sprints.set(sprintId, {
      id: sprintId,
      workspaceId: 'ws-1',
      projectId: 'p-1',
      state: SprintState.COMPLETED,
    });
    await expect(
      service.addRemoveTasks({
        workspaceId: 'ws-1',
        projectId: 'p-1',
        sprintId,
        add: ['t-1'],
        remove: [],
        actorUserId: 'u-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when the sprint is missing', async () => {
    await expect(
      service.addRemoveTasks({
        workspaceId: 'ws-1',
        projectId: 'p-1',
        sprintId: 'missing',
        add: ['t-1'],
        remove: [],
        actorUserId: 'u-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SprintPlannerService — upsertCapacity', () => {
  let state: {
    sprints: Map<string, FakeSprint>;
    tasks: Map<string, FakeTask>;
    members: Set<string>;
  };
  let prisma: ReturnType<typeof buildPrisma>;
  let service: SprintPlannerService;

  beforeEach(() => {
    state = {
      sprints: new Map([
        ['sp-1', { id: 'sp-1', workspaceId: 'ws-1', projectId: 'p-1', state: SprintState.PLANNED }],
      ]),
      tasks: new Map(),
      members: new Set(['u-1', 'u-2']),
    };
    prisma = buildPrisma(state);
    service = new SprintPlannerService(
      prisma as never,
      { record: vi.fn() } as never,
      { emit: vi.fn() } as never,
    );
  });

  it('rejects a user who is not a workspace member', async () => {
    await expect(
      service.upsertCapacity({
        workspaceId: 'ws-1',
        sprintId: 'sp-1',
        entries: [{ memberUserId: 'u-stranger', capacityPoints: 8 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('upserts capacity per member', async () => {
    await service.upsertCapacity({
      workspaceId: 'ws-1',
      sprintId: 'sp-1',
      entries: [
        { memberUserId: 'u-1', capacityPoints: 8 },
        { memberUserId: 'u-2', capacityPoints: 5 },
      ],
    });
    expect(prisma._tx.sprintCapacity.upsert).toHaveBeenCalledTimes(2);
  });
});
