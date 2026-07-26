import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EpicStatus } from '@prisma/client';
import { EpicsService } from './epics.service';

interface FakeEpic {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  description: string | null;
  status: EpicStatus;
  startQuarter: string;
  endQuarter: string;
  deletedAt: Date | null;
}

interface FakeTask {
  id: string;
  workspaceId: string;
  projectId: string;
  epicId: string | null;
  deletedAt: Date | null;
}

function makePrisma(state: { epics: Map<string, FakeEpic>; tasks: Map<string, FakeTask> }) {
  const tx = {
    epic: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => state.epics.get(where.id) ?? null,
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            workspaceId: string;
            deletedAt: null;
            projectId?: string;
            AND?: Array<{ startQuarter?: { lte: string }; endQuarter?: { gte: string } }>;
          };
        }) => {
          return [...state.epics.values()].filter((e) => {
            if (e.workspaceId !== where.workspaceId) return false;
            if (e.deletedAt) return false;
            if (where.projectId && e.projectId !== where.projectId) return false;
            for (const clause of where.AND ?? []) {
              if (clause.startQuarter && !(e.startQuarter <= clause.startQuarter.lte)) return false;
              if (clause.endQuarter && !(e.endQuarter >= clause.endQuarter.gte)) return false;
            }
            return true;
          });
        },
      ),
      create: vi.fn(async ({ data }: { data: Omit<FakeEpic, 'id' | 'deletedAt'> }) => {
        const e: FakeEpic = { id: `e-${state.epics.size + 1}`, deletedAt: null, ...data };
        state.epics.set(e.id, e);
        return e;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeEpic> }) => {
        const e = state.epics.get(where.id);
        if (!e) throw new Error('missing');
        const next = { ...e, ...data };
        state.epics.set(next.id, next);
        return next;
      }),
    },
    task: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => state.tasks.get(where.id) ?? null,
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { epicId: string | null } }) => {
          const t = state.tasks.get(where.id);
          if (!t) throw new Error('missing');
          const next = { ...t, epicId: data.epicId };
          state.tasks.set(next.id, next);
          return next;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; workspaceId: string; epicId: string };
          data: { epicId: string | null };
        }) => {
          const t = state.tasks.get(where.id);
          if (!t || t.workspaceId !== where.workspaceId || t.epicId !== where.epicId)
            return { count: 0 };
          state.tasks.set(t.id, { ...t, epicId: data.epicId });
          return { count: 1 };
        },
      ),
    },
    activity: { create: vi.fn() },
  };
  return {
    forSystem: () => ({
      $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
      epic: tx.epic,
    }),
    _tx: tx,
  };
}

function makeActivity() {
  return { record: vi.fn(async () => ({ id: 'act' })) };
}

describe('EpicsService', () => {
  let state: { epics: Map<string, FakeEpic>; tasks: Map<string, FakeTask> };
  let prisma: ReturnType<typeof makePrisma>;
  let activity: ReturnType<typeof makeActivity>;
  let service: EpicsService;

  beforeEach(() => {
    state = { epics: new Map(), tasks: new Map() };
    prisma = makePrisma(state);
    activity = makeActivity();
    service = new EpicsService(prisma as never, activity as never);
  });

  it('create rejects an inverted quarter range', async () => {
    await expect(
      service.create({
        workspaceId: 'ws-1',
        projectId: 'p-1',
        title: 'Bad',
        startQuarter: '2026-Q4',
        endQuarter: '2026-Q1',
        actorUserId: 'u-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create rejects a malformed quarter id', async () => {
    await expect(
      service.create({
        workspaceId: 'ws-1',
        projectId: 'p-1',
        title: 'Bad',
        startQuarter: '2026Q1',
        endQuarter: '2026-Q4',
        actorUserId: 'u-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('create emits epic.created activity', async () => {
    const epic = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      title: 'Ship planning',
      startQuarter: '2026-Q3',
      endQuarter: '2026-Q4',
      actorUserId: 'u-1',
    });
    expect(epic.status).toBe(EpicStatus.PLANNED);
    expect(activity.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ verb: 'epic.created' }),
    );
  });

  it('update rejects patch that inverts the quarter range against persisted state', async () => {
    const epic = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      title: 'e',
      startQuarter: '2026-Q3',
      endQuarter: '2026-Q4',
      actorUserId: 'u-1',
    });
    await expect(
      service.update('ws-1', epic.id, { startQuarter: '2027-Q1' }, 'u-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update refuses when workspace does not match', async () => {
    const epic = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      title: 'e',
      startQuarter: '2026-Q3',
      endQuarter: '2026-Q4',
      actorUserId: 'u-1',
    });
    await expect(service.update('ws-other', epic.id, { title: 'new' }, 'u-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('softDelete keeps Task.epicId intact', async () => {
    const epic = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      title: 'e',
      startQuarter: '2026-Q3',
      endQuarter: '2026-Q4',
      actorUserId: 'u-1',
    });
    state.tasks.set('t-1', {
      id: 't-1',
      workspaceId: 'ws-1',
      projectId: 'p-1',
      epicId: epic.id,
      deletedAt: null,
    });

    await service.softDelete('ws-1', epic.id, 'u-1');
    expect(state.tasks.get('t-1')?.epicId).toBe(epic.id);
    expect(state.epics.get(epic.id)?.deletedAt).not.toBeNull();
  });

  it('linkTask rejects a task in another project', async () => {
    const epic = await service.create({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      title: 'e',
      startQuarter: '2026-Q3',
      endQuarter: '2026-Q4',
      actorUserId: 'u-1',
    });
    state.tasks.set('t-other', {
      id: 't-other',
      workspaceId: 'ws-1',
      projectId: 'p-other',
      epicId: null,
      deletedAt: null,
    });
    await expect(service.linkTask('ws-1', epic.id, 't-other')).rejects.toThrow(BadRequestException);
  });

  it('roadmap orders by startQuarter then id and honors the from/to window', async () => {
    for (const [start, end] of [
      ['2026-Q1', '2026-Q1'],
      ['2026-Q3', '2026-Q4'],
      ['2027-Q1', '2027-Q1'],
    ]) {
      await service.create({
        workspaceId: 'ws-1',
        projectId: 'p-1',
        title: `${start}-${end}`,
        startQuarter: start,
        endQuarter: end,
        actorUserId: 'u-1',
      });
    }

    const list = await service.roadmap({
      workspaceId: 'ws-1',
      fromQuarter: '2026-Q3',
      toQuarter: '2026-Q4',
    });
    expect(list.map((e) => e.startQuarter)).toEqual(['2026-Q3']);
  });
});
