import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Comment, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskCommentAddedEvent, TaskEvents } from '../events/task.events';

export interface CreateCommentInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  body: string;
  actorUserId: string;
}

export interface UpdateCommentInput {
  workspaceId: string;
  commentId: string;
  body: string;
  actorUserId: string;
  actorRole: WorkspaceRole;
}

export interface RemoveCommentInput {
  workspaceId: string;
  commentId: string;
  actorUserId: string;
  actorRole: WorkspaceRole;
}

@Injectable()
export class TaskCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async create(input: CreateCommentInput): Promise<Comment> {
    const client = this.prisma.forSystem();
    const task = await client.task.findUnique({
      where: { id: input.taskId },
      select: { workspaceId: true, deletedAt: true },
    });
    if (!task || task.workspaceId !== input.workspaceId || task.deletedAt !== null) {
      throw new NotFoundException('Task not found');
    }

    const comment = await client.comment.create({
      data: {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        authorUserId: input.actorUserId,
        body: input.body,
      },
    });

    this.events.emit(TaskEvents.COMMENT_ADDED, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      commentId: comment.id,
      actorUserId: input.actorUserId,
    } satisfies TaskCommentAddedEvent);

    return comment;
  }

  async list(workspaceId: string, taskId: string): Promise<Comment[]> {
    const client = this.prisma.forSystem();
    const task = await client.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    if (!task || task.workspaceId !== workspaceId) {
      throw new NotFoundException('Task not found');
    }
    return client.comment.findMany({
      where: { taskId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(input: UpdateCommentInput): Promise<Comment> {
    const client = this.prisma.forSystem();
    const existing = await client.comment.findUnique({ where: { id: input.commentId } });
    if (!existing || existing.workspaceId !== input.workspaceId || existing.deletedAt) {
      throw new NotFoundException('Comment not found');
    }
    // Only the author may edit their own comment. Elevated roles (ADMIN,
    // OWNER) can delete but not silently rewrite someone else's words.
    if (existing.authorUserId !== input.actorUserId) {
      throw forbiddenEdit();
    }
    return client.comment.update({
      where: { id: input.commentId },
      data: { body: input.body },
    });
  }

  async remove(input: RemoveCommentInput): Promise<void> {
    const client = this.prisma.forSystem();
    const existing = await client.comment.findUnique({ where: { id: input.commentId } });
    if (!existing || existing.workspaceId !== input.workspaceId || existing.deletedAt) {
      throw new NotFoundException('Comment not found');
    }
    this.assertCanDelete(existing.authorUserId, input.actorUserId, input.actorRole);
    // Hard delete per techspec: "Soft-delete not required for MVP".
    await client.comment.delete({ where: { id: input.commentId } });
  }

  private assertCanDelete(
    authorUserId: string,
    actorUserId: string,
    actorRole: WorkspaceRole,
  ): void {
    if (actorRole === 'OWNER' || actorRole === 'ADMIN') return;
    if (authorUserId === actorUserId) return;
    throw new ForbiddenException({
      type: 'https://tasker.dev/problems/comment-delete-forbidden',
      title: 'Only the author or an Admin can delete this comment',
      status: 403,
    });
  }
}

function forbiddenEdit(): ForbiddenException {
  return new ForbiddenException({
    type: 'https://tasker.dev/problems/comment-edit-forbidden',
    title: 'Only the author can edit their comment',
    status: 403,
  });
}
