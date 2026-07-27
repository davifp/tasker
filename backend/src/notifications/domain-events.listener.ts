import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeEmitter } from '../realtime/realtime.emitter';
import { NotificationsService } from './notifications.service';
import {
  TaskCreatedEvent,
  TaskUpdatedEvent,
  TaskMovedEvent,
  TaskDeletedEvent,
  TaskEvents,
  TaskCommentAddedEvent,
} from '../tasks/events/task.events';
import {
  SprintCompletedEvent,
  SprintCreatedEvent,
  SprintEvents,
  SprintStartedEvent,
} from '../sprints/events/sprint.events';

// Central bridge between the existing `EventEmitter2` domain event bus and
// the new realtime + notifications transports introduced in Phase 8.
//
// Rationale for keeping the wiring here rather than editing every domain
// service:
//   * Existing services already emit typed EventEmitter2 events on every
//     mutation — the coverage is exactly the set the PRD requires.
//   * Everything realtime/notifications-related stays inside
//     `NotificationsModule`, avoiding transport concerns leaking into
//     `TasksService`/`SprintsService`/`TaskCommentsService`.
//   * If a future domain adds a mutation, the only touch-point to make it
//     realtime-aware is a new `@OnEvent` handler here.
@Injectable()
export class DomainEventsListener {
  private readonly logger = new Logger(DomainEventsListener.name);

  constructor(
    private readonly emitter: RealtimeEmitter,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------

  @OnEvent(TaskEvents.CREATED)
  async onTaskCreated(event: TaskCreatedEvent): Promise<void> {
    await this.emitter.emit({
      type: 'task.updated',
      workspaceId: event.workspaceId,
      taskId: event.taskId,
      payload: { verb: 'created', number: event.number },
    });
    if (event.assigneeUserId && event.assigneeUserId !== event.actorUserId) {
      await this.notifyAssigned(
        event.workspaceId,
        event.assigneeUserId,
        event.actorUserId,
        event.taskId,
      );
    }
  }

  @OnEvent(TaskEvents.UPDATED)
  async onTaskUpdated(event: TaskUpdatedEvent): Promise<void> {
    await this.emitter.emit({
      type: 'task.updated',
      workspaceId: event.workspaceId,
      taskId: event.taskId,
      payload: {},
    });
    if (event.assigneeDelta && event.assigneeDelta.currentUserId) {
      // Notify only the newly-assigned user. Unassignment does not raise a
      // bell entry (no target recipient); the WS `task.updated` still
      // updates the UI for anyone watching the task room.
      if (event.assigneeDelta.currentUserId !== event.assigneeDelta.previousUserId) {
        await this.notifyAssigned(
          event.workspaceId,
          event.assigneeDelta.currentUserId,
          event.actorUserId,
          event.taskId,
        );
      }
    }
  }

  @OnEvent(TaskEvents.MOVED)
  async onTaskMoved(event: TaskMovedEvent): Promise<void> {
    await this.emitter.emit({
      type: 'task.moved',
      workspaceId: event.workspaceId,
      taskId: event.taskId,
      payload: { fromStatus: event.fromStatus, toStatus: event.toStatus },
    });
  }

  @OnEvent(TaskEvents.DELETED)
  async onTaskDeleted(event: TaskDeletedEvent): Promise<void> {
    await this.emitter.emit({
      type: 'task.deleted',
      workspaceId: event.workspaceId,
      taskId: event.taskId,
      payload: { purgeAt: event.purgeAt.toISOString() },
    });
  }

  // ---------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------

  @OnEvent(TaskEvents.COMMENT_ADDED)
  async onCommentAdded(event: TaskCommentAddedEvent): Promise<void> {
    // The board and the drawer both listen for this — WS event lands in the
    // task room, which the RealtimeEmitter already routes into the
    // workspace room for badge counters.
    await this.emitter.emit({
      type: 'comment.created',
      workspaceId: event.workspaceId,
      taskId: event.taskId,
      commentId: event.commentId,
    });

    const [comment, mentions, followers, task] = await Promise.all([
      this.prisma.forSystem().comment.findUnique({
        where: { id: event.commentId },
        select: { body: true, authorUserId: true },
      }),
      this.prisma.forSystem().commentMention.findMany({
        where: { commentId: event.commentId },
        select: { mentionedUserId: true },
      }),
      this.followersFor(event.workspaceId, event.taskId, event.actorUserId),
      this.prisma.forSystem().task.findUnique({
        where: { id: event.taskId },
        select: { title: true, number: true, project: { select: { slug: true, name: true } } },
      }),
    ]);
    if (!comment || !task) return;

    const mentionedIds = new Set(mentions.map((m) => m.mentionedUserId));
    const followerIds = new Set(
      followers.filter((f) => !mentionedIds.has(f) && f !== event.actorUserId),
    );
    const excerpt = buildExcerpt(comment.body);

    // MENTION path — always highest priority.
    if (mentionedIds.size > 0) {
      await this.notifications.notify({
        workspaceId: event.workspaceId,
        eventType: 'COMMENT_MENTION',
        actorUserId: event.actorUserId,
        recipients: Array.from(mentionedIds),
        sourceEntity: { kind: 'COMMENT', id: event.commentId },
        payload: {
          actorDisplayName: await this.resolveDisplayName(event.actorUserId),
          taskTitle: task.title,
          projectName: task.project?.name ?? '',
          excerpt,
        },
      });
    }

    // FOLLOWED path — anyone who commented before (minus actor & mentioned).
    if (followerIds.size > 0) {
      await this.notifications.notify({
        workspaceId: event.workspaceId,
        eventType: 'COMMENT_FOLLOWED',
        actorUserId: event.actorUserId,
        recipients: Array.from(followerIds),
        sourceEntity: { kind: 'COMMENT', id: event.commentId },
        payload: {
          actorDisplayName: await this.resolveDisplayName(event.actorUserId),
          taskTitle: task.title,
          projectName: task.project?.name ?? '',
          excerpt,
        },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Sprints
  // ---------------------------------------------------------------------

  @OnEvent(SprintEvents.CREATED)
  async onSprintCreated(event: SprintCreatedEvent): Promise<void> {
    await this.emitSprint(event.workspaceId, event.sprintId, 'PLANNED');
  }

  @OnEvent(SprintEvents.STARTED)
  async onSprintStarted(event: SprintStartedEvent): Promise<void> {
    await this.emitSprint(event.workspaceId, event.sprintId, 'ACTIVE');
    await this.notifySprintLifecycle(
      event.workspaceId,
      event.sprintId,
      event.actorUserId,
      'ACTIVE',
    );
  }

  @OnEvent(SprintEvents.COMPLETED)
  async onSprintCompleted(event: SprintCompletedEvent): Promise<void> {
    await this.emitSprint(event.workspaceId, event.sprintId, 'COMPLETED');
    await this.notifySprintLifecycle(
      event.workspaceId,
      event.sprintId,
      event.actorUserId,
      'COMPLETED',
    );
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private async notifyAssigned(
    workspaceId: string,
    assigneeUserId: string,
    actorUserId: string,
    taskId: string,
  ): Promise<void> {
    const [task, actorName] = await Promise.all([
      this.prisma.forSystem().task.findUnique({
        where: { id: taskId },
        select: { title: true, project: { select: { name: true } } },
      }),
      this.resolveDisplayName(actorUserId),
    ]);
    if (!task) return;
    await this.notifications.notify({
      workspaceId,
      eventType: 'TASK_ASSIGNED',
      actorUserId,
      recipients: [assigneeUserId],
      sourceEntity: { kind: 'TASK', id: taskId },
      payload: {
        actorDisplayName: actorName,
        taskTitle: task.title,
        projectName: task.project?.name ?? '',
      },
    });
  }

  private async notifySprintLifecycle(
    workspaceId: string,
    sprintId: string,
    actorUserId: string,
    state: 'ACTIVE' | 'COMPLETED',
  ): Promise<void> {
    // A sprint has no explicit membership relation — the working definition
    // is: every user with a task inside the sprint plus every user with an
    // explicit `SprintCapacity` row. Deduped and cross-checked against the
    // actor filter downstream in `NotificationsService.notify`.
    const [sprint, tasks, capacities] = await Promise.all([
      this.prisma.forSystem().sprint.findUnique({
        where: { id: sprintId },
        select: { name: true, projectId: true },
      }),
      this.prisma.forSystem().task.findMany({
        where: { sprintId, assigneeUserId: { not: null } },
        select: { assigneeUserId: true },
        distinct: ['assigneeUserId'],
      }),
      this.prisma
        .forSystem()
        .sprintCapacity.findMany({ where: { sprintId }, select: { memberUserId: true } }),
    ]);
    if (!sprint) return;
    const project = await this.prisma
      .forSystem()
      .project.findUnique({ where: { id: sprint.projectId }, select: { name: true } });
    const recipients = new Set<string>();
    for (const row of tasks) if (row.assigneeUserId) recipients.add(row.assigneeUserId);
    for (const row of capacities) recipients.add(row.memberUserId);
    if (recipients.size === 0) return;
    await this.notifications.notify({
      workspaceId,
      eventType: 'SPRINT_LIFECYCLE',
      actorUserId,
      recipients: Array.from(recipients),
      sourceEntity: { kind: 'SPRINT', id: sprintId },
      payload: {
        actorDisplayName: await this.resolveDisplayName(actorUserId),
        sprintName: sprint.name,
        projectName: project?.name ?? '',
        state,
      },
    });
  }

  private async emitSprint(
    workspaceId: string,
    sprintId: string,
    state: 'PLANNED' | 'ACTIVE' | 'COMPLETED',
  ): Promise<void> {
    await this.emitter.emit({
      type: 'sprint.updated',
      workspaceId,
      sprintId,
      state,
    });
  }

  // A follower is anyone who has commented on the same task in the past.
  // The PRD intentionally leaves the definition loose — the guarantee is
  // that the actor never sees their own comment echoed back.
  private async followersFor(
    workspaceId: string,
    taskId: string,
    actorUserId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.forSystem().comment.findMany({
      where: { workspaceId, taskId, deletedAt: null },
      select: { authorUserId: true },
      distinct: ['authorUserId'],
    });
    return rows.map((r) => r.authorUserId).filter((id) => id !== actorUserId);
  }

  private async resolveDisplayName(userId: string): Promise<string> {
    const row = await this.prisma
      .forSystem()
      .user.findUnique({ where: { id: userId }, select: { displayName: true } });
    return row?.displayName ?? 'Someone';
  }
}

function buildExcerpt(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length <= 140 ? collapsed : `${collapsed.slice(0, 139)}…`;
}
