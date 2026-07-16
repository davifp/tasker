import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { WorkspaceRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { satisfiesRole } from './roles';
import { WorkspaceContext } from './workspace-context.store';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<WorkspaceRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { workspaceContext?: WorkspaceContext }>();
    const ctx = req.workspaceContext;

    if (!ctx) {
      // No workspace context but @Roles was declared — misconfiguration.
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/workspace-context-missing',
        title: 'Workspace context required',
        detail: 'This endpoint requires a workspace context but none was resolved.',
        status: 403,
      });
    }

    const permitted = required.some((r) => satisfiesRole(ctx.role, r));
    if (!permitted) {
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/insufficient-role',
        title: 'Insufficient role',
        detail: `This action requires one of: ${required.join(', ')}. Your role: ${ctx.role}.`,
        status: 403,
      });
    }

    return true;
  }
}
