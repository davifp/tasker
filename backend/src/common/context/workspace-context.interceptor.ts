import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { WorkspaceContext, WorkspaceContextStore } from './workspace-context.store';

// WorkspaceGuard sets `req.workspaceContext` synchronously and calls
// `store.enterWith(ctx)` for the async chain rooted at the guard. That
// enterWith does not survive into the handler chain because NestJS awaits
// the guard's result in a different async context. This interceptor closes
// the gap by wrapping the downstream handler pipeline in `store.run(ctx, …)`
// so any `forTenant()` query or ALS-scoped read inside services sees the
// active workspace context.
@Injectable()
export class WorkspaceContextInterceptor implements NestInterceptor {
  constructor(private readonly store: WorkspaceContextStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { workspaceContext?: WorkspaceContext }>();
    const ctx = req.workspaceContext;
    if (!ctx) return next.handle();

    return new Observable<unknown>((subscriber) => {
      const subscription = this.store.run(ctx, () => next.handle().subscribe(subscriber));
      return () => subscription.unsubscribe();
    });
  }
}
