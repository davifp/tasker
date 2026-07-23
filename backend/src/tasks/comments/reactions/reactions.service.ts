import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CommentReaction, Prisma } from '@prisma/client';
import { isReactionEmoji, type ReactionEmoji } from '@tasker/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActivityService } from '../../../common/activity/activity.service';

export interface ReactionActor {
  workspaceId: string;
  userId: string;
  actorDisplayName?: string;
}

export interface ReactionSummary {
  emoji: ReactionEmoji;
  count: number;
  reactorSample: Array<{ userId: string; displayName: string }>;
  reactedByMe: boolean;
}

const REACTOR_SAMPLE_SIZE = 5;

@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Idempotent add. A repeat is a no-op that returns the pre-existing row.
   * Only emits an activity entry when a row is actually created — repeat
   * calls do not produce phantom activity noise.
   */
  async add(commentId: string, emoji: string, actor: ReactionActor): Promise<CommentReaction> {
    assertKnownEmoji(emoji);
    const client = this.prisma.forSystem();
    const comment = await this.findLiveComment(client, actor.workspaceId, commentId);

    // Race-safe idempotent add: fast-path returns an existing row without a
    // transaction. Slow-path enters a tx, tries to create, and treats a
    // unique-constraint violation as "another concurrent request beat us
    // to it" — the losing request emits no activity, which matches the
    // "single row + single activity" success criterion.
    const existing = await client.commentReaction.findUnique({
      where: { commentId_userId_emoji: { commentId, userId: actor.userId, emoji } },
    });
    if (existing) return existing;

    try {
      return await client.$transaction(async tx => {
        const row = await tx.commentReaction.create({
          data: {
            workspaceId: actor.workspaceId,
            commentId,
            userId: actor.userId,
            emoji,
          },
        });
        await this.activity.record(tx, {
          workspaceId: actor.workspaceId,
          projectId: comment.projectId,
          taskId: comment.taskId,
          actorUserId: actor.userId,
          verb: 'reaction.added',
          payload: {
            actorDisplayName: actor.actorDisplayName,
            commentId,
            emoji,
          },
        });
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const row = await client.commentReaction.findUnique({
          where: { commentId_userId_emoji: { commentId, userId: actor.userId, emoji } },
        });
        if (row) return row;
      }
      throw err;
    }
  }

  /**
   * Idempotent remove. Removing a reaction that never existed is a no-op —
   * the caller cannot distinguish this from "just removed", which matches
   * the PRD's idempotency intent.
   */
  async remove(commentId: string, emoji: string, actor: ReactionActor): Promise<void> {
    assertKnownEmoji(emoji);
    const client = this.prisma.forSystem();
    const comment = await this.findLiveComment(client, actor.workspaceId, commentId);

    await client.$transaction(async tx => {
      const deleted = await tx.commentReaction.deleteMany({
        where: {
          commentId,
          userId: actor.userId,
          emoji,
        },
      });
      if (deleted.count === 0) return;
      await this.activity.record(tx, {
        workspaceId: actor.workspaceId,
        projectId: comment.projectId,
        taskId: comment.taskId,
        actorUserId: actor.userId,
        verb: 'reaction.removed',
        payload: {
          actorDisplayName: actor.actorDisplayName,
          commentId,
          emoji,
        },
      });
    });
  }

  /**
   * Grouped totals per emoji for a single comment. Returns every catalog
   * entry (count 0 for unused) so the client can render a stable bar order.
   */
  async list(commentId: string, actor: ReactionActor): Promise<ReactionSummary[]> {
    const client = this.prisma.forSystem();
    await this.findLiveComment(client, actor.workspaceId, commentId);

    const rows = await client.commentReaction.findMany({
      where: { commentId },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const byEmoji = new Map<string, {
      count: number;
      reactors: Array<{ userId: string; displayName: string }>;
      reactedByMe: boolean;
    }>();
    for (const r of rows) {
      const entry = byEmoji.get(r.emoji) ?? { count: 0, reactors: [], reactedByMe: false };
      entry.count += 1;
      if (entry.reactors.length < REACTOR_SAMPLE_SIZE) {
        entry.reactors.push({ userId: r.user.id, displayName: r.user.displayName });
      }
      if (r.userId === actor.userId) entry.reactedByMe = true;
      byEmoji.set(r.emoji, entry);
    }

    const summary: ReactionSummary[] = [];
    for (const [emoji, entry] of byEmoji.entries()) {
      if (!isReactionEmoji(emoji)) continue;
      summary.push({
        emoji,
        count: entry.count,
        reactorSample: entry.reactors,
        reactedByMe: entry.reactedByMe,
      });
    }
    return summary;
  }

  private async findLiveComment(
    client: ReturnType<PrismaService['forSystem']>,
    workspaceId: string,
    commentId: string,
  ) {
    const comment = await client.comment.findUnique({
      where: { id: commentId },
      select: { workspaceId: true, taskId: true, deletedAt: true, task: { select: { projectId: true } } },
    });
    if (!comment || comment.workspaceId !== workspaceId) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.deletedAt !== null) {
      throw new BadRequestException({
        type: 'https://tasker.dev/problems/comment-deleted',
        title: 'Cannot react to a deleted comment',
        status: 400,
      });
    }
    return { taskId: comment.taskId, projectId: comment.task.projectId };
  }
}

function assertKnownEmoji(emoji: string): asserts emoji is ReactionEmoji {
  if (!isReactionEmoji(emoji)) {
    throw new BadRequestException({
      type: 'https://tasker.dev/problems/reaction-not-allowed',
      title: 'Emoji not in the workspace reaction catalog',
      status: 400,
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
