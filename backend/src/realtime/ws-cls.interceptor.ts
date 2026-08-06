import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { ClsService } from 'nestjs-cls';
import { firstValueFrom, from, Observable } from 'rxjs';
import type { Socket } from 'socket.io';
import { CLS_TRACE_ID, CLS_USER_ID, CLS_WORKSPACE_ID } from '../common/cls/cls-keys';
import { SOCKET_USER_KEY } from './ws-auth.guard';

interface SocketData {
  [SOCKET_USER_KEY]?: { userId: string };
  workspaceId?: string;
}

/**
 * Wraps every `@SubscribeMessage` handler in its own CLS scope so log
 * enrichment and OTel `traceId` propagation work for WebSocket events the
 * same way they do for HTTP requests.
 *
 * WebSocket messages have no per-message HTTP headers, so we mint a fresh
 * trace via `tracer.startActiveSpan`. `userId` and `workspaceId` come from
 * `socket.data`, seeded by `RealtimeGateway.handleConnection` after the
 * ticket exchange.
 */
@Injectable()
export class WsClsInterceptor implements NestInterceptor {
  private readonly tracer = trace.getTracer('tasker.ws');

  constructor(private readonly cls: ClsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'ws') return next.handle();

    const socket = ctx.switchToWs().getClient<Socket>();
    const data = (socket.data ?? {}) as SocketData;
    const userId = data[SOCKET_USER_KEY]?.userId;
    const workspaceId = data.workspaceId;
    const event = ctx.getHandler().name;

    return from(
      this.tracer.startActiveSpan(
        `ws.${event}`,
        { kind: SpanKind.SERVER, attributes: { 'ws.event': event } },
        (span) =>
          this.cls.run(async () => {
            this.cls.set(CLS_TRACE_ID, span.spanContext().traceId);
            if (userId) this.cls.set(CLS_USER_ID, userId);
            if (workspaceId) this.cls.set(CLS_WORKSPACE_ID, workspaceId);
            try {
              // Force materialization here so the CLS scope stays open for the
              // entire handler chain (subsequent `.pipe(map(...))` operators
              // would otherwise execute outside the run() callback).
              const result = await firstValueFrom(next.handle());
              span.setStatus({ code: SpanStatusCode.OK });
              return result;
            } catch (err) {
              span.recordException(err as Error);
              span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
              throw err;
            } finally {
              span.end();
            }
          }),
      ),
    );
  }
}
