import { Injectable } from '@nestjs/common';
import { Prisma, Activity } from '@prisma/client';
import type { ActivityVerb } from '@tasker/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityBus } from './activity.bus';

export interface ActivityEntry {
  workspaceId: string;
  projectId: string;
  taskId?: string | null;
  actorUserId?: string | null;
  verb: ActivityVerb;
  payload: ActivityPayload;
}

/**
 * Compact self-contained snapshot rendered by the client without a second
 * fetch. Verb-specific shapes are documented per verb in techspec §
 * Development sequencing.
 */
export interface ActivityPayload {
  // Denormalised for feed rendering.
  actorDisplayName?: string;
  targetTitle?: string;
  // task.status_changed
  from?: string;
  to?: string;
  // comment.* / reaction.* / attachment.*
  commentId?: string;
  commentExcerpt?: string;
  emoji?: string;
  attachmentId?: string;
  attachmentFilename?: string;
}

export interface ActivityView {
  id: string;
  workspaceId: string;
  projectId: string;
  taskId: string | null;
  actorUserId: string | null;
  verb: ActivityVerb;
  payload: ActivityPayload;
  createdAt: Date;
}

export interface ActivityPage {
  items: ActivityView[];
  nextCursor: string | null;
}

export interface ListActivityOptions {
  cursor?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: ActivityBus,
  ) {}

  /**
   * Writes an Activity row using the caller's transaction client so the
   * domain change and the activity emission commit together atomically.
   * Publishes to the ActivityBus for observers (metrics, logs); the bus
   * emission is best-effort and does not roll back the DB write.
   */
  async record(tx: Prisma.TransactionClient, entry: ActivityEntry): Promise<Activity> {
    const row = await tx.activity.create({
      data: {
        workspaceId: entry.workspaceId,
        projectId: entry.projectId,
        taskId: entry.taskId ?? null,
        actorUserId: entry.actorUserId ?? null,
        verb: entry.verb,
        payload: entry.payload as unknown as Prisma.InputJsonValue,
      },
    });
    this.bus.publish({
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      taskId: row.taskId,
      actorUserId: row.actorUserId,
      verb: row.verb as ActivityVerb,
      activityId: row.id,
    });
    return row;
  }

  async listForTask(
    workspaceId: string,
    taskId: string,
    opts: ListActivityOptions = {},
  ): Promise<ActivityPage> {
    return this.list({ workspaceId, where: { taskId }, ...opts });
  }

  async listForProject(
    workspaceId: string,
    projectId: string,
    opts: ListActivityOptions = {},
  ): Promise<ActivityPage> {
    return this.list({ workspaceId, where: { projectId }, ...opts });
  }

  private async list(input: {
    workspaceId: string;
    where: Prisma.ActivityWhereInput;
    cursor?: string;
    limit?: number;
  }): Promise<ActivityPage> {
    const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    // Use raw client with an explicit workspace filter — this endpoint is
    // called from a workspace-scoped handler and the tenant extension would
    // also inject workspaceId, but being explicit here documents intent and
    // means the query works uniformly whether or not the ALS context is set
    // (tests, internal callers).
    const rows = await this.prisma.forSystem().activity.findMany({
      where: { workspaceId: input.workspaceId, ...input.where },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, -1) : rows).map(rowToView);
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  }
}

function rowToView(row: Activity): ActivityView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    taskId: row.taskId,
    actorUserId: row.actorUserId,
    verb: row.verb as ActivityVerb,
    payload: (row.payload ?? {}) as ActivityPayload,
    createdAt: row.createdAt,
  };
}
