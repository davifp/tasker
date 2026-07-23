import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ActivityVerb } from '@tasker/config';

/**
 * Light-weight publish surface for activity events. The primary write path is
 * `ActivityService.record(tx, entry)` — the bus exists for cross-cutting
 * observers (structured logs, metrics, future real-time push in Phase 8)
 * that must not couple back into the service.
 *
 * Events are published under the topic `activity.<verb>` so subscribers can
 * filter by verb without decoding payloads.
 */
export interface ActivityBusEvent {
  workspaceId: string;
  projectId: string;
  taskId: string | null;
  actorUserId: string | null;
  verb: ActivityVerb;
  activityId: string;
}

const TOPIC_PREFIX = 'activity';

@Injectable()
export class ActivityBus {
  private readonly logger = new Logger(ActivityBus.name);

  constructor(private readonly emitter: EventEmitter2) {}

  publish(event: ActivityBusEvent): void {
    this.emitter.emit(`${TOPIC_PREFIX}.${event.verb}`, event);
    // Wildcard fan-out for the interceptor.
    this.emitter.emit(`${TOPIC_PREFIX}.*`, event);
    this.logger.log({
      msg: 'activity.emitted',
      verb: event.verb,
      workspaceId: event.workspaceId,
      actorUserId: event.actorUserId,
      projectId: event.projectId,
      taskId: event.taskId,
      activityId: event.activityId,
    });
  }

  /** Subscribes to every activity event (used by ActivityInterceptor). */
  onAny(handler: (event: ActivityBusEvent) => void): () => void {
    const wildcard = `${TOPIC_PREFIX}.*`;
    this.emitter.on(wildcard, handler);
    return () => this.emitter.off(wildcard, handler);
  }
}
