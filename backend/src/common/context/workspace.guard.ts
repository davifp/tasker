import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtUser } from '../../auth/strategies/jwt.strategy';
import { WorkspaceContext } from './workspace-context.store';

// Resolves the workspace context for every authenticated request that carries
// either an `X-Workspace-Id` header or a `:slug` URL param. Loads the caller's
// WorkspaceMember, sets `req.workspaceContext`, and rejects with 403 on missing
// membership. Skips @Public routes and routes with neither signal (e.g. /me).
// The ALS scope is entered downstream by WorkspaceContextInterceptor.
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser; params: Record<string, string> }>();

    const user = req.user;
    if (!user) return true; // JwtAuthGuard already rejected — nothing to do.

    const headerId = (req.headers['x-workspace-id'] as string | undefined)?.trim();
    const slug = req.params?.['slug'];

    // No workspace signal on the request → not a workspace-scoped route.
    if (!headerId && !slug) return true;

    // URL slug is authoritative when present — workspace resolution, membership
    // check, and ctx.workspaceId below all key off it. A stale X-Workspace-Id
    // from a cookie is ignored, not rejected: legitimate any time the user
    // navigates across workspaces faster than the cookie updates.
    const workspace = slug
      ? await this.prisma.forSystem().workspace.findUnique({ where: { slug } })
      : await this.prisma.forSystem().workspace.findUnique({ where: { id: headerId! } });

    const isRestoreRoute =
      req.method === 'POST' && typeof req.path === 'string' && req.path.endsWith('/restore');

    if (!workspace || (workspace.deletedAt && !isRestoreRoute)) {
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/workspace-not-found',
        title: 'Workspace not accessible',
        detail: 'The workspace does not exist or you do not have access to it.',
        status: 403,
      });
    }

    const membership = await this.prisma.forSystem().workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/workspace-membership-required',
        title: 'Workspace membership required',
        detail: 'You must be a member of this workspace.',
        status: 403,
      });
    }

    const ctx: WorkspaceContext = {
      userId: user.userId,
      workspaceId: workspace.id,
      role: membership.role,
      membershipId: membership.id,
    };

    // Attach to the request for synchronous access from RolesGuard and controllers.
    // The ALS scope for downstream services is opened by WorkspaceContextInterceptor.
    (req as unknown as { workspaceContext: WorkspaceContext }).workspaceContext = ctx;
    return true;
  }
}
