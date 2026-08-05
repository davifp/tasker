import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import type { JwtUser } from '../../auth/strategies/jwt.strategy';
import type { WorkspaceContext } from '../context/workspace-context.store';
import { CLS_USER_ID, CLS_WORKSPACE_ID } from './cls-keys';

interface RequestWithContext extends Request {
  user?: JwtUser;
  workspaceContext?: WorkspaceContext;
}

@Injectable()
export class ContextEnrichmentInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() === 'http' && this.cls.isActive()) {
      const req = ctx.switchToHttp().getRequest<RequestWithContext>();
      const userId = req.user?.userId ?? req.workspaceContext?.userId;
      if (userId) this.cls.set(CLS_USER_ID, userId);
      const workspaceId = req.workspaceContext?.workspaceId;
      if (workspaceId) this.cls.set(CLS_WORKSPACE_ID, workspaceId);
    }
    return next.handle();
  }
}
