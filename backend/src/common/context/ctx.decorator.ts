import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { WorkspaceContext } from './workspace-context.store';

// Injects the resolved WorkspaceContext into a controller handler parameter.
// Requires WorkspaceGuard to have run and populated req.workspaceContext.
export const Ctx = createParamDecorator(
  (_data: unknown, execCtx: ExecutionContext): WorkspaceContext | undefined => {
    const req = execCtx.switchToHttp().getRequest<{ workspaceContext?: WorkspaceContext }>();
    return req.workspaceContext;
  },
);
