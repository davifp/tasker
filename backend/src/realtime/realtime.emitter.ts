import { Injectable, Logger, Optional } from '@nestjs/common';
import { Server } from 'socket.io';
import { realtimeEventSchema, RealtimeEvent } from '@tasker/config';
import { RealtimeMetricsCollector } from '../metrics/realtime.metrics';

// Room name conventions. Kept as pure functions so tests can assert them
// without spinning up the gateway.
export const workspaceRoom = (workspaceId: string): string => `ws:${workspaceId}`;
export const taskRoom = (workspaceId: string, taskId: string): string =>
  `task:${workspaceId}:${taskId}`;
export const userRoom = (userId: string): string => `user:${userId}`;

// Task 8.0 will replace this pass-through with a per-recipient RBAC scrub.
// Kept here so the emitter contract lands with Task 2.0 and downstream
// callers do not need to change signature later.
export type PayloadScrubber = (event: RealtimeEvent) => RealtimeEvent;

@Injectable()
export class RealtimeEmitter {
  private readonly logger = new Logger(RealtimeEmitter.name);
  private server?: Server;
  private scrubber: PayloadScrubber = (e) => e;

  // Optional so unit tests that instantiate the emitter without the
  // MetricsModule DI graph still work; `@Optional()` prevents Nest from
  // failing to construct the emitter when the collector is unavailable.
  constructor(@Optional() private readonly metrics?: RealtimeMetricsCollector) {}

  // Called once by the gateway after @WebSocketServer() resolves.
  bind(server: Server): void {
    this.server = server;
  }

  // Task 8.0 injects a real scrubber; unit tests can swap it too.
  setScrubber(scrubber: PayloadScrubber): void {
    this.scrubber = scrubber;
  }

  // Publishes to the correct set of rooms based on the event type:
  //   * task.*         → task room (fine-grained followers) + workspace room
  //   * comment.*      → task room + workspace room
  //   * activity.added → task room + workspace room
  //   * sprint.updated → workspace room
  //   * notification.new → recipient's user room only
  async emit(event: RealtimeEvent): Promise<void> {
    const parsed = realtimeEventSchema.safeParse(event);
    if (!parsed.success) {
      this.logger.warn({ issues: parsed.error.errors }, 'Dropping malformed realtime event');
      this.metrics?.incrementEvent(String((event as { type?: string }).type), 'dropped');
      return;
    }
    if (!this.server) {
      // In tests without a bound server this is a no-op. In production the
      // gateway binds the server at boot; missing binding is a real bug.
      this.logger.warn({ type: event.type }, 'RealtimeEmitter has no server bound');
      this.metrics?.incrementEvent(event.type, 'dropped');
      return;
    }
    const rooms = this.roomsFor(event);
    const payload = this.scrubber(event);
    try {
      for (const room of rooms) {
        this.server.to(room).emit(event.type, payload);
      }
      this.metrics?.incrementEvent(event.type, 'success');
    } catch (err) {
      this.metrics?.incrementEvent(event.type, 'error');
      throw err;
    }
  }

  // Escape hatch for the /realtime/ping smoke endpoint — emits a payload not
  // part of the RealtimeEvent union to a single room. Not for domain use.
  emitRaw(room: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn({ event }, 'RealtimeEmitter.emitRaw called with no server bound');
      return;
    }
    this.server.to(room).emit(event, payload);
  }

  roomsFor(event: RealtimeEvent): string[] {
    switch (event.type) {
      case 'task.updated':
      case 'task.moved':
      case 'task.deleted':
      case 'comment.created':
      case 'comment.updated':
      case 'comment.deleted':
      case 'activity.added':
        return [taskRoom(event.workspaceId, event.taskId), workspaceRoom(event.workspaceId)];
      case 'sprint.updated':
        return [workspaceRoom(event.workspaceId)];
      case 'notification.new':
        return [userRoom(event.recipientUserId)];
    }
  }
}
