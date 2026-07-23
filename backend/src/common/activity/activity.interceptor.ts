import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ActivityBus, type ActivityBusEvent } from './activity.bus';

/**
 * Cross-cutting observer of activity emissions. Increments an in-memory
 * per-verb counter (exposed via `getCounters()` for tests and future
 * Prometheus exporter wiring) and produces one structured log line per
 * activity. Purely observational — never mutates the emission and never
 * throws (a subscriber throwing would break event delivery to other
 * observers).
 *
 * Registered as an `APP_INTERCEPTOR` so it also acts as a lifecycle handle
 * (`OnModuleInit`/`OnModuleDestroy`) to hook and unhook the bus subscription
 * exactly once per app instance.
 */
@Injectable()
export class ActivityInterceptor implements NestInterceptor, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ActivityFeed');
  private readonly counters = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly bus: ActivityBus) {}

  onModuleInit(): void {
    this.unsubscribe = this.bus.onAny((event) => this.handle(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle();
  }

  /** Returns a defensive copy of the per-verb counters (for tests + future metrics). */
  getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  private handle(event: ActivityBusEvent): void {
    const key = event.verb;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
    this.logger.log({
      msg: 'activity.recorded',
      verb: event.verb,
      workspaceId: event.workspaceId,
      projectId: event.projectId,
      taskId: event.taskId,
      actorUserId: event.actorUserId,
      activityId: event.activityId,
    });
  }
}
