import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import type { WebhookEventType } from '@tasker/config';
import { ProjectEvents } from '../../projects/events/project.events';
import type {
  ProjectCreatedEvent,
  ProjectDeletedEvent,
  ProjectUpdatedEvent,
} from '../../projects/events/project.events';
import { SprintEvents } from '../../sprints/events/sprint.events';
import type {
  SprintCompletedEvent,
  SprintCreatedEvent,
  SprintStartedEvent,
} from '../../sprints/events/sprint.events';
import { TaskEvents } from '../../tasks/events/task.events';
import type {
  TaskCommentAddedEvent,
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskUpdatedEvent,
} from '../../tasks/events/task.events';
import { WEBHOOK_DELIVERY_JOB, WEBHOOK_DELIVERY_QUEUE } from '../../queues/constants';
import { WEBHOOK_BACKOFF_STRATEGY_NAME } from './webhook-backoff.strategy';
import type { WebhookDeliveryJobData } from './webhook-delivery.types';
import { WebhooksService } from './webhooks.service';

/**
 * Fan-out step: for each domain event, look up active subscribers whose
 * `eventTypes` array contains the wire name, then enqueue one delivery per
 * subscriber. The enqueue carries the retry policy so the processor never
 * has to compute it — a value change here is picked up by the *next* event,
 * previously-enqueued jobs finish under their captured settings.
 */
@Injectable()
export class WebhookDispatcherListener {
  private readonly logger = new Logger(WebhookDispatcherListener.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly queue: Queue,
  ) {
    this.maxAttempts = config.get<number>('WEBHOOK_MAX_ATTEMPTS', 24);
  }

  @OnEvent(TaskEvents.CREATED, { async: true })
  async onTaskCreated(event: TaskCreatedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'TASK_CREATED', {
      taskId: event.taskId,
      projectId: event.projectId,
      number: event.number,
      actorUserId: event.actorUserId,
      assigneeUserId: event.assigneeUserId ?? null,
    });
  }

  @OnEvent(TaskEvents.UPDATED, { async: true })
  async onTaskUpdated(event: TaskUpdatedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'TASK_UPDATED', {
      taskId: event.taskId,
      projectId: event.projectId,
      actorUserId: event.actorUserId,
      assigneeDelta: event.assigneeDelta ?? null,
    });
  }

  @OnEvent(TaskEvents.DELETED, { async: true })
  async onTaskDeleted(event: TaskDeletedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'TASK_DELETED', {
      taskId: event.taskId,
      projectId: event.projectId,
      actorUserId: event.actorUserId,
      purgeAt: event.purgeAt.toISOString(),
    });
  }

  @OnEvent(TaskEvents.COMMENT_ADDED, { async: true })
  async onCommentAdded(event: TaskCommentAddedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'COMMENT_CREATED', {
      commentId: event.commentId,
      taskId: event.taskId,
      projectId: event.projectId,
      actorUserId: event.actorUserId,
    });
  }

  @OnEvent(ProjectEvents.CREATED, { async: true })
  async onProjectCreated(event: ProjectCreatedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'PROJECT_CREATED', {
      projectId: event.projectId,
      slug: event.slug,
      actorUserId: event.actorUserId,
    });
  }

  @OnEvent(ProjectEvents.UPDATED, { async: true })
  async onProjectUpdated(event: ProjectUpdatedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'PROJECT_UPDATED', {
      projectId: event.projectId,
      actorUserId: event.actorUserId,
    });
  }

  @OnEvent(ProjectEvents.DELETED, { async: true })
  async onProjectDeleted(event: ProjectDeletedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'PROJECT_DELETED', {
      projectId: event.projectId,
      actorUserId: event.actorUserId,
      purgeAt: event.purgeAt.toISOString(),
    });
  }

  @OnEvent(SprintEvents.CREATED, { async: true })
  async onSprintCreated(event: SprintCreatedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'SPRINT_CREATED', {
      sprintId: event.sprintId,
      projectId: event.projectId,
      actorUserId: event.actorUserId,
    });
  }

  @OnEvent(SprintEvents.STARTED, { async: true })
  async onSprintStarted(event: SprintStartedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'SPRINT_STARTED', {
      sprintId: event.sprintId,
      projectId: event.projectId,
      actorUserId: event.actorUserId,
    });
  }

  @OnEvent(SprintEvents.COMPLETED, { async: true })
  async onSprintCompleted(event: SprintCompletedEvent): Promise<void> {
    await this.fanout(event.workspaceId, 'SPRINT_COMPLETED', {
      sprintId: event.sprintId,
      projectId: event.projectId,
      actorUserId: event.actorUserId,
    });
  }

  private async fanout(
    workspaceId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    let subscribers: Array<{ id: string }> = [];
    try {
      subscribers = await this.webhooks.findActiveSubscribers(workspaceId, eventType);
    } catch (err) {
      this.logger.warn({ err, workspaceId, eventType }, 'Failed to load webhook subscribers');
      return;
    }
    if (subscribers.length === 0) return;
    const eventId = randomUUID();
    for (const subscriber of subscribers) {
      const data: WebhookDeliveryJobData = {
        webhookId: subscriber.id,
        workspaceId,
        eventType,
        eventId,
        payload,
      };
      try {
        await this.queue.add(WEBHOOK_DELIVERY_JOB, data, {
          attempts: this.maxAttempts,
          backoff: { type: WEBHOOK_BACKOFF_STRATEGY_NAME },
          removeOnComplete: 100,
          removeOnFail: 100,
        });
      } catch (err) {
        this.logger.warn(
          { err, webhookId: subscriber.id, eventType },
          'Failed to enqueue webhook delivery',
        );
      }
    }
  }
}
