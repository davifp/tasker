import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { realtimeEventSchema, RealtimeEvent } from '@tasker/config';

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
      return;
    }
    if (!this.server) {
      // In tests without a bound server this is a no-op. In production the
      // gateway binds the server at boot; missing binding is a real bug.
      this.logger.warn({ type: event.type }, 'RealtimeEmitter has no server bound');
      return;
    }
    const rooms = this.roomsFor(event);
    const payload = this.scrubber(event);
    for (const room of rooms) {
      this.server.to(room).emit(event.type, payload);
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
