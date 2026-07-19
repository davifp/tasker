import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskEvents } from './events/task.events';

const WS = 'ws-1';
const PROJECT = 'proj-1';
const USER = 'user-1';
const OTHER_USER = 'user-2';
const TASK = 'task-1';

// ---------------------------------------------------------------------------
// Mock Prisma client — a mutable object shared across tests
// ---------------------------------------------------------------------------

const taskClient = {
  create: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
};
const projectSequenceClient = {
  upsert: vi.fn(),
};
const taskLabelClient = {
  deleteMany: vi.fn(),
  createMany: vi.fn(),
};

const taskDependencyClient = {
  findMany: vi.fn().mockResolvedValue([]),
};

const checklistItemClient = {
  groupBy: vi.fn().mockResolvedValue([]),
};

const rawClient = {
  task: taskClient,
  projectSequence: projectSequenceClient,
  taskLabel: taskLabelClient,
  taskDependency: taskDependencyClient,
  checklistItem: checklistItemClient,
  $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(rawClient)),
  $executeRawUnsafe: vi.fn().mockResolvedValue(0),
};

const mockPrisma = { forSystem: vi.fn(() => rawClient) };
const emit = vi.fn();

async function buildService(): Promise<TasksService> {
  const module = await Test.createTestingModule({
    providers: [
      TasksService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: EventEmitter2, useValue: { emit } },
    ],
  }).compile();
  return module.get(TasksService);
}

function makePositionConflict(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['projectId', 'position'] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// create — transactional numbering
// ---------------------------------------------------------------------------

describe('TasksService.create', () => {
  it('claims number = nextNumber - 1 via ProjectSequence upsert and emits CREATED', async () => {
    const service = await buildService();
    projectSequenceClient.upsert.mockResolvedValueOnce({ projectId: PROJECT, nextNumber: 5 });
    taskClient.findFirst.mockResolvedValueOnce(null);
    taskClient.create.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      number: 4,
      status: 'BACKLOG',
    });

    const task = await service.create({
      workspaceId: WS,
      projectId: PROJECT,
      title: 'First',
      actorUserId: USER,
    });

    expect(task.number).toBe(4);
    expect(projectSequenceClient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT },
        create: { projectId: PROJECT, nextNumber: 2 },
        update: { nextNumber: { increment: 1 } },
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      TaskEvents.CREATED,
      expect.objectContaining({ taskId: TASK, number: 4 }),
    );
  });

  it('retries once with a fresh tail on position conflict', async () => {
    const service = await buildService();
    // Sequence returns different values on retry (upsert increments each call)
    projectSequenceClient.upsert.mockResolvedValue({ projectId: PROJECT, nextNumber: 2 });
    // Tail reads: first empty, then a live tail after the collision
    taskClient.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ position: 'a1' });
    taskClient.create
      .mockRejectedValueOnce(makePositionConflict())
      .mockResolvedValueOnce({ id: TASK, workspaceId: WS, projectId: PROJECT, number: 1 });

    const task = await service.create({
      workspaceId: WS,
      projectId: PROJECT,
      title: 'Retry',
      actorUserId: USER,
    });

    expect(task.id).toBe(TASK);
    expect(taskClient.create).toHaveBeenCalledTimes(2);
  });

  it('throws position-conflict Problem Details after retry exhaustion', async () => {
    const service = await buildService();
    projectSequenceClient.upsert.mockResolvedValue({ projectId: PROJECT, nextNumber: 2 });
    taskClient.findFirst.mockResolvedValue(null);
    taskClient.create.mockRejectedValue(makePositionConflict());

    await expect(
      service.create({ workspaceId: WS, projectId: PROJECT, title: 'Fail', actorUserId: USER }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(taskClient.create).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// move — stale-write + position-conflict retry
// ---------------------------------------------------------------------------

describe('TasksService.move', () => {
  const NOW = new Date('2026-07-17T12:00:00.000Z');

  it('rejects a stale write when ifUnchangedSince does not match', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'BACKLOG',
      updatedAt: new Date('2026-07-17T11:00:00.000Z'),
      deletedAt: null,
    });

    try {
      await service.move({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: TASK,
        status: 'IN_PROGRESS',
        position: 'a2',
        ifUnchangedSince: NOW,
        actorUserId: USER,
      });
      expect.fail('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const response = (err as ConflictException).getResponse() as { type: string };
      expect(response.type).toBe('https://tasker.dev/problems/stale-write');
    }
    expect(taskClient.update).not.toHaveBeenCalled();
  });

  it('regenerates position when caller-supplied slot collides with a live sibling', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'BACKLOG',
      updatedAt: NOW,
      deletedAt: null,
    });
    // 1st findFirst: collision probe returns a sibling — must regenerate
    // 2nd findFirst: tail read for the fresh key
    taskClient.findFirst
      .mockResolvedValueOnce({ id: 'sibling' })
      .mockResolvedValueOnce({ position: 'a3' });
    taskClient.update.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'IN_PROGRESS',
      updatedAt: new Date(),
    });

    const result = await service.move({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      status: 'IN_PROGRESS',
      position: 'a2',
      ifUnchangedSince: NOW,
      actorUserId: USER,
    });

    expect(result.kind).toBe('moved');
    if (result.kind === 'moved') {
      expect(result.task.status).toBe('IN_PROGRESS');
    }
    expect(taskClient.update).toHaveBeenCalledTimes(1);
    const updateCall = taskClient.update.mock.calls[0][0] as { data: { position?: string } };
    expect(updateCall.data.position).not.toBe('a2');
    expect(emit).toHaveBeenCalledWith(
      TaskEvents.MOVED,
      expect.objectContaining({ fromStatus: 'BACKLOG', toStatus: 'IN_PROGRESS' }),
    );
  });

  it('uses the caller-supplied position verbatim when no live sibling holds it', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'BACKLOG',
      updatedAt: NOW,
      deletedAt: null,
    });
    taskClient.findFirst.mockResolvedValueOnce(null);
    taskClient.update.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'IN_PROGRESS',
      updatedAt: new Date(),
    });

    await service.move({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      status: 'IN_PROGRESS',
      position: 'a2',
      ifUnchangedSince: NOW,
      actorUserId: USER,
    });

    const updateCall = taskClient.update.mock.calls[0][0] as { data: { position?: string } };
    expect(updateCall.data.position).toBe('a2');
  });

  it('throws NotFoundException when the task is soft-deleted', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'BACKLOG',
      updatedAt: NOW,
      deletedAt: new Date(),
    });

    await expect(
      service.move({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: TASK,
        status: 'DONE',
        position: 'a2',
        ifUnchangedSince: NOW,
        actorUserId: USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns kind: 'blocked' with acknowledgedBlockersOpen on DONE transition with open blockers", async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'IN_REVIEW',
      updatedAt: NOW,
      deletedAt: null,
    });
    taskDependencyClient.findMany.mockResolvedValueOnce([
      { blockedBy: { number: 7, project: { slug: 'web' } } },
      { blockedBy: { number: 12, project: { slug: 'web' } } },
    ]);

    const result = await service.move({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      status: 'DONE',
      position: 'a2',
      ifUnchangedSince: NOW,
      actorUserId: USER,
    });

    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') {
      expect(result.acknowledgedBlockersOpen).toEqual(['web-7', 'web-12']);
    }
    // The blocked branch must NOT emit MOVED — no state changed.
    expect(taskClient.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('transitions to DONE when overrideBlockers=true, even with open blockers', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'IN_REVIEW',
      updatedAt: NOW,
      deletedAt: null,
    });
    taskClient.findFirst.mockResolvedValueOnce(null);
    taskClient.update.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'DONE',
      updatedAt: new Date(),
    });

    const result = await service.move({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      status: 'DONE',
      position: 'a2',
      ifUnchangedSince: NOW,
      actorUserId: USER,
      overrideBlockers: true,
    });

    expect(result.kind).toBe('moved');
    // When overrideBlockers=true we skip the blocker probe entirely.
    expect(taskDependencyClient.findMany).not.toHaveBeenCalled();
    expect(taskClient.update).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      TaskEvents.MOVED,
      expect.objectContaining({ toStatus: 'DONE' }),
    );
  });

  it('skips the blocker check when the task is already DONE (no fromStatus change to DONE)', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'DONE',
      updatedAt: NOW,
      deletedAt: null,
    });
    taskClient.findFirst.mockResolvedValueOnce(null);
    taskClient.update.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'DONE',
      updatedAt: new Date(),
    });

    await service.move({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      status: 'DONE',
      position: 'a2',
      ifUnchangedSince: NOW,
      actorUserId: USER,
    });

    expect(taskDependencyClient.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// softDelete — RBAC branches
// ---------------------------------------------------------------------------

describe('TasksService.softDelete', () => {
  it('MEMBER can delete their own task', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      createdByUserId: USER,
      deletedAt: null,
    });
    taskClient.update.mockResolvedValueOnce({ id: TASK, workspaceId: WS, projectId: PROJECT });

    await service.softDelete({ workspaceId: WS, taskId: TASK, actorUserId: USER, actorRole: 'MEMBER' });
    expect(taskClient.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });

  it("MEMBER cannot delete someone else's task", async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      createdByUserId: OTHER_USER,
      deletedAt: null,
    });

    try {
      await service.softDelete({ workspaceId: WS, taskId: TASK, actorUserId: USER, actorRole: 'MEMBER' });
      expect.fail('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as { type: string };
      expect(response.type).toBe('https://tasker.dev/problems/task-delete-forbidden');
    }
    expect(taskClient.update).not.toHaveBeenCalled();
  });

  it("ADMIN can delete anyone's task", async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      createdByUserId: OTHER_USER,
      deletedAt: null,
    });
    taskClient.update.mockResolvedValueOnce({ id: TASK, workspaceId: WS, projectId: PROJECT });

    await service.softDelete({ workspaceId: WS, taskId: TASK, actorUserId: USER, actorRole: 'ADMIN' });
    expect(taskClient.update).toHaveBeenCalled();
  });

  it("OWNER can delete anyone's task", async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      createdByUserId: OTHER_USER,
      deletedAt: null,
    });
    taskClient.update.mockResolvedValueOnce({ id: TASK, workspaceId: WS, projectId: PROJECT });

    await service.softDelete({ workspaceId: WS, taskId: TASK, actorUserId: USER, actorRole: 'OWNER' });
    expect(taskClient.update).toHaveBeenCalled();
  });

  it('throws NotFoundException when the task belongs to a different workspace', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: 'other-ws',
      projectId: PROJECT,
      createdByUserId: USER,
      deletedAt: null,
    });

    await expect(
      service.softDelete({ workspaceId: WS, taskId: TASK, actorUserId: USER, actorRole: 'OWNER' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when the task is already soft-deleted', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      createdByUserId: USER,
      deletedAt: new Date(),
    });

    await expect(
      service.softDelete({ workspaceId: WS, taskId: TASK, actorUserId: USER, actorRole: 'MEMBER' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

describe('TasksService.restore', () => {
  it('clears deletedAt/purgeAt on happy path', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'BACKLOG',
      createdByUserId: USER,
      deletedAt: new Date(),
      purgeAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    taskClient.update.mockResolvedValueOnce({ id: TASK, workspaceId: WS, projectId: PROJECT });

    await service.restore({ workspaceId: WS, taskId: TASK, actorUserId: USER, actorRole: 'MEMBER' });
    expect(taskClient.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: null, purgeAt: null }) }),
    );
  });

  it('regenerates position on P2002 collision', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'BACKLOG',
      createdByUserId: USER,
      deletedAt: new Date(),
      purgeAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    taskClient.findFirst.mockResolvedValueOnce({ position: 'a5' });
    taskClient.update
      .mockRejectedValueOnce(makePositionConflict())
      .mockResolvedValueOnce({ id: TASK, workspaceId: WS, projectId: PROJECT });

    await service.restore({ workspaceId: WS, taskId: TASK, actorUserId: USER, actorRole: 'OWNER' });
    expect(taskClient.update).toHaveBeenCalledTimes(2);
    const secondCall = taskClient.update.mock.calls[1][0] as { data: { position?: string } };
    expect(secondCall.data.position).toBeDefined();
  });

  it('throws BadRequestException when the purge window has elapsed', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({
      id: TASK,
      workspaceId: WS,
      projectId: PROJECT,
      status: 'BACKLOG',
      createdByUserId: USER,
      deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      purgeAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    await expect(
      service.restore({ workspaceId: WS, taskId: TASK, actorUserId: USER, actorRole: 'OWNER' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// listForProject
// ---------------------------------------------------------------------------

describe('TasksService.listForProject', () => {
  it('excludes soft-deleted tasks by default and clamps limit', async () => {
    const service = await buildService();
    taskClient.findMany = vi.fn().mockResolvedValueOnce([]);
    // Wire findMany onto the raw client for this test only.
    (rawClient as unknown as { task: unknown }).task = {
      ...taskClient,
      findMany: taskClient.findMany,
    };

    await service.listForProject(WS, PROJECT, { limit: 200 });
    expect(taskClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WS,
          projectId: PROJECT,
          deletedAt: null,
        }),
        take: 101,
      }),
    );
  });

  // Regression for BUG-08.H3 — the board card renders a checklist
  // progress badge (PRD subtask 8.6). The service must hydrate
  // checklistDone/checklistTotal per task using a pair of grouped
  // aggregates instead of an N+1 fetch.
  it('hydrates checklistDone + checklistTotal per task from grouped aggregates', async () => {
    const service = await buildService();
    const now = new Date();
    const taskRow = {
      id: 't-1',
      workspaceId: WS,
      projectId: PROJECT,
      number: 1,
      title: 'A',
      description: '',
      status: 'TODO',
      priority: 'MEDIUM',
      position: 'a0',
      assigneeUserId: null,
      createdByUserId: USER,
      dueDate: null,
      deletedAt: null,
      purgeAt: null,
      createdAt: now,
      updatedAt: now,
      labels: [],
    };
    taskClient.findMany = vi.fn().mockResolvedValueOnce([taskRow, { ...taskRow, id: 't-2', number: 2 }]);
    (rawClient as unknown as { task: unknown }).task = {
      ...taskClient,
      findMany: taskClient.findMany,
    };
    // First groupBy → totals; second → done. Prisma's `_count._all` shape.
    checklistItemClient.groupBy
      .mockResolvedValueOnce([
        { taskId: 't-1', _count: { _all: 3 } },
        { taskId: 't-2', _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([{ taskId: 't-1', _count: { _all: 2 } }]);

    const page = await service.listForProject(WS, PROJECT);

    expect(checklistItemClient.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['taskId'],
      where: { taskId: { in: ['t-1', 't-2'] } },
      _count: { _all: true },
    });
    expect(checklistItemClient.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['taskId'],
      where: { taskId: { in: ['t-1', 't-2'] }, checked: true },
      _count: { _all: true },
    });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ id: 't-1', checklistTotal: 3, checklistDone: 2 });
    // Task with no `done` groupBy row still gets 0, not undefined.
    expect(page.items[1]).toMatchObject({ id: 't-2', checklistTotal: 1, checklistDone: 0 });
  });

  // Second regression case: task with zero checklist items reports
  // { total: 0, done: 0 } instead of leaking undefined into the response.
  it('emits checklistTotal=0/checklistDone=0 for tasks with no checklist items', async () => {
    const service = await buildService();
    const now = new Date();
    taskClient.findMany = vi.fn().mockResolvedValueOnce([
      {
        id: 't-9',
        workspaceId: WS,
        projectId: PROJECT,
        number: 9,
        title: 'B',
        description: '',
        status: 'TODO',
        priority: 'MEDIUM',
        position: 'a0',
        assigneeUserId: null,
        createdByUserId: USER,
        dueDate: null,
        deletedAt: null,
        purgeAt: null,
        createdAt: now,
        updatedAt: now,
        labels: [],
      },
    ]);
    (rawClient as unknown as { task: unknown }).task = {
      ...taskClient,
      findMany: taskClient.findMany,
    };
    checklistItemClient.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const page = await service.listForProject(WS, PROJECT);

    expect(page.items[0]).toMatchObject({
      id: 't-9',
      checklistTotal: 0,
      checklistDone: 0,
    });
  });
});
