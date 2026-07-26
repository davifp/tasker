import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import type { Prisma } from '@prisma/client';
import { WorkspaceContext } from '../context/workspace-context.store';
import { AUDITABLE_META_KEY, type AuditableOptions } from './auditable.decorator';
import { AuditService } from './audit.service';
import { AUDIT_SENSITIVE_KEY_PATTERNS } from '@tasker/config';

// Global interceptor that records an audit entry after any controller handler
// decorated with `@Auditable(...)` returns a 2xx response.
//
// Contract:
//   - No decorator → no-op.
//   - Handler threw → tap's next never fires; no entry recorded.
//   - AuditService.record() fails → swallowed and logged; the request completes
//     normally (audit is observability, not correctness).
//
// The interceptor runs after WorkspaceContextInterceptor (registered order in
// AppModule) so `req.workspaceContext` is available for tenant scoping.
@Injectable()
export class AuditMutationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditMutationInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditableOptions | undefined>(
      AUDITABLE_META_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return next.handle();

    const req = context
      .switchToHttp()
      .getRequest<Request & { workspaceContext?: WorkspaceContext; user?: { userId: string } }>();

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          void this.recordSafely(meta, req, body);
        },
        // No error branch — thrown handlers must not produce audit rows.
      }),
    );
  }

  private async recordSafely(
    meta: AuditableOptions,
    req: Request & { workspaceContext?: WorkspaceContext; user?: { userId: string } },
    body: unknown,
  ): Promise<void> {
    try {
      const targetId = meta.targetIdFrom ? meta.targetIdFrom(req, body) : undefined;
      await this.audit.record({
        event: meta.event,
        actorUserId: req.workspaceContext?.userId ?? req.user?.userId,
        workspaceId: req.workspaceContext?.workspaceId,
        targetType: meta.targetType,
        targetId,
        metadata: this.summarizeRequest(req, body) as Prisma.InputJsonValue,
      });
    } catch (err) {
      this.logger.warn({ err, event: meta.event }, 'Failed to record audit mutation entry');
    }
  }

  /**
   * Compact JSON summary written to `AuditLog.metadata`. Includes route,
   * method, and route params; the request body is included with sensitive
   * keys stripped. The full response body is deliberately not persisted —
   * that's what the entity table itself is for.
   */
  private summarizeRequest(req: Request, _body: unknown): Record<string, unknown> {
    return {
      method: req.method,
      path: req.route?.path ?? req.path,
      params: req.params,
      body: stripSensitive(req.body),
    };
  }
}

function stripSensitive(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => stripSensitive(v));
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (AUDIT_SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p))) {
      out[key] = '[masked]';
    } else {
      out[key] = stripSensitive(val);
    }
  }
  return out;
}
