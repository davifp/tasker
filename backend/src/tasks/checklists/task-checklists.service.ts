import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChecklistItem, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Positions } from '../../common/ordering/positions';
import { TaskChecklistToggledEvent, TaskEvents } from '../events/task.events';

type PrismaTx = Prisma.TransactionClient;

export interface CreateChecklistItemInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  title: string;
  actorUserId: string;
}

export interface UpdateChecklistItemInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  itemId: string;
  patch: { title?: string; checked?: boolean; position?: string };
  actorUserId: string;
}

@Injectable()
export class TaskChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async create(input: CreateChecklistItemInput): Promise<ChecklistItem> {
    return this.prisma.forSystem().$transaction(async (tx) => {
      await this.assertTaskInWorkspace(tx, input.taskId, input.workspaceId);
      const tail = await this.readTailPosition(tx, input.taskId);
      const position = Positions.between(tail, null);
      return tx.checklistItem.create({
        data: { taskId: input.taskId, title: input.title, position },
      });
    });
  }

  async list(workspaceId: string, taskId: string): Promise<ChecklistItem[]> {
    const client = this.prisma.forSystem();
    await this.assertTaskInWorkspace(client, taskId, workspaceId);
    return client.checklistItem.findMany({
      where: { taskId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
  }

  async update(input: UpdateChecklistItemInput): Promise<ChecklistItem> {
    const { patch } = input;
    const result = await this.prisma.forSystem().$transaction(async (tx) => {
      await this.assertTaskInWorkspace(tx, input.taskId, input.workspaceId);
      const existing = await tx.checklistItem.findUnique({ where: { id: input.itemId } });
      if (!existing || existing.taskId !== input.taskId) {
        throw new NotFoundException('Checklist item not found');
      }
      const before = existing.checked;
      const updated = await tx.checklistItem.update({
        where: { id: input.itemId },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.checked !== undefined ? { checked: patch.checked } : {}),
          ...(patch.position !== undefined ? { position: patch.position } : {}),
        },
      });
      return { updated, toggled: before !== updated.checked };
    });

    if (result.toggled) {
      this.events.emit(TaskEvents.CHECKLIST_TOGGLED, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        taskId: input.taskId,
        itemId: result.updated.id,
        checked: result.updated.checked,
        actorUserId: input.actorUserId,
      } satisfies TaskChecklistToggledEvent);
    }

    return result.updated;
  }

  async remove(workspaceId: string, taskId: string, itemId: string): Promise<void> {
    await this.prisma.forSystem().$transaction(async (tx) => {
      await this.assertTaskInWorkspace(tx, taskId, workspaceId);
      const existing = await tx.checklistItem.findUnique({ where: { id: itemId } });
      if (!existing || existing.taskId !== taskId) {
        throw new NotFoundException('Checklist item not found');
      }
      await tx.checklistItem.delete({ where: { id: itemId } });
    });
  }

  private async assertTaskInWorkspace(
    client: PrismaTx | ReturnType<PrismaService['forSystem']>,
    taskId: string,
    workspaceId: string,
  ): Promise<void> {
    const task = await client.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true, deletedAt: true },
    });
    if (!task || task.workspaceId !== workspaceId || task.deletedAt !== null) {
      throw new NotFoundException('Task not found');
    }
  }

  private async readTailPosition(tx: PrismaTx, taskId: string): Promise<string | null> {
    const tail = await tx.checklistItem.findFirst({
      where: { taskId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return tail?.position ?? null;
  }
}
