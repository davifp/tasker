import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { TaskDependenciesService } from './task-dependencies.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskEvents } from '../events/task.events';

const WS = 'ws-1';
const PROJECT = 'proj-1';
const A = 'task-A';
const B = 'task-B';
const C = 'task-C';

const taskClient = {
  findUnique: vi.fn(),
};
const taskDependencyClient = {
  create: vi.fn(),
  delete: vi.fn(),
  findMany: vi.fn(),
};
const rawClient = {
  task: taskClient,
  taskDependency: taskDependencyClient,
  $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(rawClient)),
};

const mockPrisma = { forSystem: vi.fn(() => rawClient) };
const emit = vi.fn();

async function buildService(): Promise<TaskDependenciesService> {
  const module = await Test.createTestingModule({
    providers: [
      TaskDependenciesService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: EventEmitter2, useValue: { emit } },
    ],
  }).compile();
  return module.get(TaskDependenciesService);
}

function makeTask(): { workspaceId: string; projectId: string; deletedAt: null } {
  return { workspaceId: WS, projectId: PROJECT, deletedAt: null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TaskDependenciesService.add', () => {
  it('rejects self-loop (A blocks A) as a cycle', async () => {
    const service = await buildService();
    await expect(
      service.add({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: A,
        blockedByTaskId: A,
        actorUserId: 'u-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(taskDependencyClient.create).not.toHaveBeenCalled();
  });

  it('rejects blocker from another project', async () => {
    const service = await buildService();
    taskClient.findUnique
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce({ ...makeTask(), projectId: 'other-proj' });
    await expect(
      service.add({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: A,
        blockedByTaskId: B,
        actorUserId: 'u-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('detects a direct back-edge cycle (B blocks A; then adding A blocks B)', async () => {
    const service = await buildService();
    taskClient.findUnique
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce(makeTask());
    // wouldFormCycle DFS from B: B is blockedBy A → hits origin
    taskDependencyClient.findMany.mockResolvedValueOnce([{ blockedByTaskId: A }]);

    await expect(
      service.add({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: A,
        blockedByTaskId: B,
        actorUserId: 'u-1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        type: 'https://tasker.dev/problems/dependency-cycle',
      }),
    });
    expect(taskDependencyClient.create).not.toHaveBeenCalled();
  });

  it('detects a transitive cycle (A → B → C, then adding C blocks A closes it)', async () => {
    const service = await buildService();
    taskClient.findUnique
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce(makeTask());
    // Adding "C blockedBy A": DFS from A. Edges: A→B, B→C. Reaches C == originTaskId (C).
    taskDependencyClient.findMany
      .mockResolvedValueOnce([{ blockedByTaskId: B }]) // A's blockers
      .mockResolvedValueOnce([{ blockedByTaskId: C }]) // B's blockers
      .mockResolvedValueOnce([]); // C's blockers (unreached because we short-circuit)

    await expect(
      service.add({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: C,
        blockedByTaskId: A,
        actorUserId: 'u-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates the dependency on a happy-path chain (A blocks B; no cycle)', async () => {
    const service = await buildService();
    taskClient.findUnique
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce(makeTask());
    // DFS from B finds no back-edge to A
    taskDependencyClient.findMany.mockResolvedValueOnce([]);
    taskDependencyClient.create.mockResolvedValueOnce({ taskId: A, blockedByTaskId: B });

    await service.add({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: A,
      blockedByTaskId: B,
      actorUserId: 'u-1',
    });

    expect(taskDependencyClient.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { taskId: A, blockedByTaskId: B } }),
    );
    expect(emit).toHaveBeenCalledWith(
      TaskEvents.DEPENDENCY_ADDED,
      expect.objectContaining({ taskId: A, blockedByTaskId: B }),
    );
  });

  it('maps P2002 (duplicate edge) to 409 dependency-exists', async () => {
    const service = await buildService();
    taskClient.findUnique
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce(makeTask());
    taskDependencyClient.findMany.mockResolvedValueOnce([]);
    taskDependencyClient.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    try {
      await service.add({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: A,
        blockedByTaskId: B,
        actorUserId: 'u-1',
      });
      expect.fail('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const response = (err as ConflictException).getResponse() as { type: string };
      expect(response.type).toBe('https://tasker.dev/problems/dependency-exists');
    }
  });

  it('throws NotFoundException when blocker is soft-deleted', async () => {
    const service = await buildService();
    taskClient.findUnique
      .mockResolvedValueOnce(makeTask())
      .mockResolvedValueOnce({ ...makeTask(), deletedAt: new Date() });
    await expect(
      service.add({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: A,
        blockedByTaskId: B,
        actorUserId: 'u-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TaskDependenciesService.remove', () => {
  it('deletes an existing dependency', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: WS });
    taskDependencyClient.delete.mockResolvedValueOnce({ taskId: A, blockedByTaskId: B });

    await service.remove({ workspaceId: WS, taskId: A, blockedByTaskId: B });
    expect(taskDependencyClient.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId_blockedByTaskId: { taskId: A, blockedByTaskId: B } },
      }),
    );
  });

  it('maps P2025 to NotFoundException', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: WS });
    taskDependencyClient.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.remove({ workspaceId: WS, taskId: A, blockedByTaskId: B }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
