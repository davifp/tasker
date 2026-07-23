import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Comment, WorkspaceRole } from '@prisma/client';
import { Queue } from 'bullmq';
import { COMMENT_MENTION_JOB, NOTIFICATIONS_QUEUE } from '../../queues/constants';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../../common/activity/activity.service';
import { TaskCommentAddedEvent, TaskEvents } from '../events/task.events';
import { MentionParser } from './mentions/mention-parser';
import { MentionsService } from './mentions/mentions.service';

export interface CreateCommentInput {
  workspaceId: string;
  projectId: string;
  taskId: string;
  body: string;
  actorUserId: string;
  actorDisplayName?: string;
}

export interface UpdateCommentInput {
  workspaceId: string;
  commentId: string;
  body: string;
  actorUserId: string;
  actorRole: WorkspaceRole;
  actorDisplayName?: string;
}

export interface RemoveCommentInput {
  workspaceId: string;
  commentId: string;
  actorUserId: string;
  actorRole: WorkspaceRole;
  actorDisplayName?: string;
}

export interface CommentView {
  id: string;
  workspaceId: string;
  taskId: string;
  authorUserId: string;
  body: string;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  mentions: Array<{ userId: string; offset: number }>;
}

const EXCERPT_LEN = 140;

@Injectable()
export class TaskCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly activity: ActivityService,
    private readonly parser: MentionParser,
    private readonly mentions: MentionsService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notifications: Queue,
  ) {}

  async create(input: CreateCommentInput): Promise<CommentView> {
    const client = this.prisma.forSystem();
    const task = await client.task.findUnique({
      where: { id: input.taskId },
      select: { workspaceId: true, projectId: true, deletedAt: true, title: true },
    });
    if (!task || task.workspaceId !== input.workspaceId || task.deletedAt !== null) {
      throw new NotFoundException('Task not found');
    }

    // One transaction wraps: comment row, mention rows, activity row.
    // Notification jobs are enqueued AFTER commit so a rollback doesn't
    // leave dangling jobs.
    const { comment, resolved } = await client.$transaction(async tx => {
      const comment = await tx.comment.create({
        data: {
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          authorUserId: input.actorUserId,
          body: input.body,
        },
      });

      const candidates = this.parser.extract(input.body);
      const resolved = await this.mentions.resolve(tx, input.workspaceId, candidates);

      if (resolved.length > 0) {
        await tx.commentMention.createMany({
          data: resolved.map(r => ({
            workspaceId: input.workspaceId,
            commentId: comment.id,
            mentionedUserId: r.userId,
            offset: r.offset,
          })),
        });
      }

      await this.activity.record(tx, {
        workspaceId: input.workspaceId,
        projectId: task.projectId,
        taskId: input.taskId,
        actorUserId: input.actorUserId,
        verb: 'comment.created',
        payload: {
          actorDisplayName: input.actorDisplayName,
          targetTitle: task.title,
          commentId: comment.id,
          commentExcerpt: excerpt(input.body),
        },
      });

      return { comment, resolved };
    });

    await this.enqueueMentionNotifications({
      workspaceId: input.workspaceId,
      commentId: comment.id,
      taskId: input.taskId,
      actorUserId: input.actorUserId,
      mentions: resolved,
    });

    this.events.emit(TaskEvents.COMMENT_ADDED, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      commentId: comment.id,
      actorUserId: input.actorUserId,
    } satisfies TaskCommentAddedEvent);

    return this.toView(comment, resolved.map(r => ({ userId: r.userId, offset: r.offset })));
  }

  async list(workspaceId: string, taskId: string): Promise<CommentView[]> {
    const client = this.prisma.forSystem();
    const task = await client.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    if (!task || task.workspaceId !== workspaceId) {
      throw new NotFoundException('Task not found');
    }
    const rows = await client.comment.findMany({
      where: { taskId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { mentions: { select: { mentionedUserId: true, offset: true } } },
    });
    return rows.map(r =>
      this.toView(
        r,
        r.mentions.map(m => ({ userId: m.mentionedUserId, offset: m.offset })),
      ),
    );
  }

  async update(input: UpdateCommentInput): Promise<CommentView> {
    const client = this.prisma.forSystem();
    const existing = await client.comment.findUnique({
      where: { id: input.commentId },
      include: { task: { select: { projectId: true, title: true } } },
    });
    if (!existing || existing.workspaceId !== input.workspaceId || existing.deletedAt) {
      throw new NotFoundException('Comment not found');
    }
    if (existing.authorUserId !== input.actorUserId) {
      throw commentEditForbidden();
    }

    const { updated, newlyAdded, allMentions } = await client.$transaction(async tx => {
      const updated = await tx.comment.update({
        where: { id: input.commentId },
        data: { body: input.body, editedAt: new Date() },
      });

      // Diff mentions: extract from new body, resolve, then reconcile with
      // the current set — delete rows for users no longer present, insert
      // rows for newly-added users. Unchanged rows stay untouched so their
      // createdAt remains stable (relevant to the mentioned-user inbox
      // ordering).
      const candidates = this.parser.extract(input.body);
      const resolved = await this.mentions.resolve(tx, input.workspaceId, candidates);
      const resolvedIds = new Set(resolved.map(r => r.userId));

      const current = await tx.commentMention.findMany({
        where: { commentId: input.commentId },
        select: { mentionedUserId: true, offset: true },
      });
      const currentIds = new Set(current.map(c => c.mentionedUserId));

      const toRemove = current.filter(c => !resolvedIds.has(c.mentionedUserId));
      const toAdd = resolved.filter(r => !currentIds.has(r.userId));

      if (toRemove.length > 0) {
        await tx.commentMention.deleteMany({
          where: {
            commentId: input.commentId,
            mentionedUserId: { in: toRemove.map(r => r.mentionedUserId) },
          },
        });
      }
      if (toAdd.length > 0) {
        await tx.commentMention.createMany({
          data: toAdd.map(r => ({
            workspaceId: input.workspaceId,
            commentId: input.commentId,
            mentionedUserId: r.userId,
            offset: r.offset,
          })),
        });
      }

      await this.activity.record(tx, {
        workspaceId: input.workspaceId,
        projectId: existing.task.projectId,
        taskId: existing.taskId,
        actorUserId: input.actorUserId,
        verb: 'comment.edited',
        payload: {
          actorDisplayName: input.actorDisplayName,
          targetTitle: existing.task.title,
          commentId: input.commentId,
          commentExcerpt: excerpt(input.body),
        },
      });

      return {
        updated,
        newlyAdded: toAdd,
        allMentions: resolved.map(r => ({ userId: r.userId, offset: r.offset })),
      };
    });

    await this.enqueueMentionNotifications({
      workspaceId: input.workspaceId,
      commentId: input.commentId,
      taskId: existing.taskId,
      actorUserId: input.actorUserId,
      mentions: newlyAdded,
    });

    return this.toView(updated, allMentions);
  }

  async remove(input: RemoveCommentInput): Promise<void> {
    const client = this.prisma.forSystem();
    const existing = await client.comment.findUnique({
      where: { id: input.commentId },
      include: { task: { select: { projectId: true, title: true } } },
    });
    if (!existing || existing.workspaceId !== input.workspaceId || existing.deletedAt) {
      throw new NotFoundException('Comment not found');
    }
    this.assertCanDelete(existing.authorUserId, input.actorUserId, input.actorRole);

    await client.$transaction(async tx => {
      await tx.comment.update({
        where: { id: input.commentId },
        data: { deletedAt: new Date() },
      });
      await this.activity.record(tx, {
        workspaceId: input.workspaceId,
        projectId: existing.task.projectId,
        taskId: existing.taskId,
        actorUserId: input.actorUserId,
        verb: 'comment.deleted',
        payload: {
          actorDisplayName: input.actorDisplayName,
          targetTitle: existing.task.title,
          commentId: input.commentId,
        },
      });
    });
  }

  private toView(
    row: Comment,
    mentions: Array<{ userId: string; offset: number }>,
  ): CommentView {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      taskId: row.taskId,
      authorUserId: row.authorUserId,
      body: row.body,
      editedAt: row.editedAt ?? null,
      deletedAt: row.deletedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      mentions,
    };
  }

  private async enqueueMentionNotifications(input: {
    workspaceId: string;
    commentId: string;
    taskId: string;
    actorUserId: string;
    mentions: Array<{ userId: string }>;
  }): Promise<void> {
    if (input.mentions.length === 0) return;
    await Promise.all(
      input.mentions.map(m =>
        this.notifications.add(COMMENT_MENTION_JOB, {
          type: 'comment.mention' as const,
          workspaceId: input.workspaceId,
          commentId: input.commentId,
          taskId: input.taskId,
          mentionedUserId: m.userId,
          actorUserId: input.actorUserId,
        }),
      ),
    );
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

function excerpt(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length <= EXCERPT_LEN ? collapsed : `${collapsed.slice(0, EXCERPT_LEN - 1)}…`;
}

function commentEditForbidden(): ForbiddenException {
  return new ForbiddenException({
    type: 'https://tasker.dev/problems/comment-edit-forbidden',
    title: 'Only the author can edit their comment',
    status: 403,
  });
}

