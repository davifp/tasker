import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TaskChecklistsService } from './task-checklists.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskEvents } from '../events/task.events';

const WS = 'ws-1';
const PROJECT = 'proj-1';
const TASK = 'task-1';
const ITEM = 'item-1';
const USER = 'user-1';

const taskClient = { findUnique: vi.fn() };
const checklistClient = {
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

const rawClient = {
  task: taskClient,
  checklistItem: checklistClient,
  $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(rawClient)),
};

const mockPrisma = { forSystem: vi.fn(() => rawClient) };
const emit = vi.fn();

async function buildService(): Promise<TaskChecklistsService> {
  const module = await Test.createTestingModule({
    providers: [
      TaskChecklistsService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: EventEmitter2, useValue: { emit } },
    ],
  }).compile();
  return module.get(TaskChecklistsService);
}

beforeEach(() => vi.clearAllMocks());

describe('TaskChecklistsService.create', () => {
  it('appends after the tail using Positions.between', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: WS, deletedAt: null });
    checklistClient.findFirst.mockResolvedValueOnce({ position: 'a5' });
    checklistClient.create.mockResolvedValueOnce({ id: ITEM, taskId: TASK });

    const item = await service.create({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      title: 'Do the thing',
      actorUserId: USER,
    });

    expect(item.id).toBe(ITEM);
    const call = checklistClient.create.mock.calls[0][0] as { data: { position: string } };
    expect(call.data.position > 'a5').toBe(true);
  });

  it('throws NotFoundException if the parent task is missing or cross-workspace', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: 'other', deletedAt: null });
    await expect(
      service.create({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: TASK,
        title: 'x',
        actorUserId: USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TaskChecklistsService.update', () => {
  it('accepts a reorder patch with a valid position', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: WS, deletedAt: null });
    checklistClient.findUnique.mockResolvedValueOnce({
      id: ITEM,
      taskId: TASK,
      checked: false,
      position: 'a5',
    });
    checklistClient.update.mockResolvedValueOnce({
      id: ITEM,
      taskId: TASK,
      checked: false,
      position: 'a3',
    });

    await service.update({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      itemId: ITEM,
      patch: { position: 'a3' },
      actorUserId: USER,
    });
    expect(checklistClient.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { position: 'a3' } }),
    );
    // No CHECKLIST_TOGGLED event on a pure reorder.
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits CHECKLIST_TOGGLED when checked state flips', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: WS, deletedAt: null });
    checklistClient.findUnique.mockResolvedValueOnce({
      id: ITEM,
      taskId: TASK,
      checked: false,
    });
    checklistClient.update.mockResolvedValueOnce({
      id: ITEM,
      taskId: TASK,
      checked: true,
    });

    await service.update({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      itemId: ITEM,
      patch: { checked: true },
      actorUserId: USER,
    });
    expect(emit).toHaveBeenCalledWith(
      TaskEvents.CHECKLIST_TOGGLED,
      expect.objectContaining({ itemId: ITEM, checked: true }),
    );
  });

  it('does not emit when the checked state is unchanged', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: WS, deletedAt: null });
    checklistClient.findUnique.mockResolvedValueOnce({
      id: ITEM,
      taskId: TASK,
      checked: true,
    });
    checklistClient.update.mockResolvedValueOnce({
      id: ITEM,
      taskId: TASK,
      checked: true,
    });

    await service.update({
      workspaceId: WS,
      projectId: PROJECT,
      taskId: TASK,
      itemId: ITEM,
      patch: { title: 'renamed' },
      actorUserId: USER,
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('rejects patching an item that belongs to a different task', async () => {
    const service = await buildService();
    taskClient.findUnique.mockResolvedValueOnce({ workspaceId: WS, deletedAt: null });
    checklistClient.findUnique.mockResolvedValueOnce({
      id: ITEM,
      taskId: 'other-task',
      checked: false,
    });

    await expect(
      service.update({
        workspaceId: WS,
        projectId: PROJECT,
        taskId: TASK,
        itemId: ITEM,
        patch: { checked: true },
        actorUserId: USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
