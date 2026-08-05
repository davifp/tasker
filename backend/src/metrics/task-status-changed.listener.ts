import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { METRICS_REFRESH_DEBOUNCE_SEC_DEFAULT } from '@tasker/config';
import type { ActivityBusEvent } from '../common/activity/activity.bus';
import { withJobTelemetry } from '../observability/bullmq-tracing';
import { METRICS_QUEUE, METRICS_REFRESH_JOB_WORKSPACE } from '../queues/constants';

/**
 * Bridges the `ActivityBus` (`task.status_changed` verb) and the sprint
 * lifecycle events to the metrics refresh queue. Per-workspace Redis
 * debounce collapses a burst of transitions into a single enqueue window.
 */
@Injectable()
export class TaskStatusChangedListener implements OnModuleInit {
  private readonly logger = new Logger(TaskStatusChangedListener.name);
  private debounceSec = METRICS_REFRESH_DEBOUNCE_SEC_DEFAULT;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: Redis,
    @InjectQueue(METRICS_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.debounceSec = this.config.get<number>(
      'METRICS_REFRESH_DEBOUNCE_SEC',
      METRICS_REFRESH_DEBOUNCE_SEC_DEFAULT,
    );
  }

  @OnEvent('activity.task.status_changed')
  async onTaskStatusChanged(event: ActivityBusEvent): Promise<void> {
    await this.debouncedEnqueue(event.workspaceId);
  }

  @OnEvent('sprint.started')
  async onSprintStarted(event: { workspaceId: string }): Promise<void> {
    // Sprint transitions bypass the debounce — burndown must reflect the
    // new snapshot immediately.
    await this.enqueue(event.workspaceId);
  }

  @OnEvent('sprint.completed')
  async onSprintCompleted(event: { workspaceId: string }): Promise<void> {
    await this.enqueue(event.workspaceId);
  }

  private async debouncedEnqueue(workspaceId: string): Promise<void> {
    // SETNX on a per-workspace key with EX = debounce window. If another
    // event within the window already set the key, this call is a no-op —
    // exactly one enqueue lands per window.
    const key = `metrics:refresh:debounce:${workspaceId}`;
    const acquired = await this.redis.set(key, '1', 'EX', this.debounceSec, 'NX');
    if (!acquired) return;
    await this.enqueue(workspaceId);
  }

  private async enqueue(workspaceId: string): Promise<void> {
    try {
      await this.queue.add(
        METRICS_REFRESH_JOB_WORKSPACE,
        withJobTelemetry({ workspaceId }, { workspaceId }),
        { removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (err) {
      this.logger.warn({ err, workspaceId }, 'Failed to enqueue metrics refresh');
    }
  }
}
