import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtUser } from '../../auth/strategies/jwt.strategy';
import type { WorkspaceContext } from './workspace-context.store';

// Enforces the "public demo is strictly read-only" rule at the HTTP layer.
// Runs after JwtAuthGuard so `req.user.isDemo` is populated, and after
// WorkspaceGuard so `req.workspaceContext.role` is populated too.
//
// Two independent triggers reject a mutating verb:
//   1. `req.user.isDemo` — set by `JwtStrategy` when the session belongs to
//      the seeded demo account. Catches endpoints with no `:slug`
//      (invitation-accept, `/me/*`) where WorkspaceGuard cannot resolve a
//      workspaceContext.
//   2. `req.workspaceContext.role === 'DEMO_VIEWER'` — catches any non-demo
//      user who somehow gained the demo role in a real workspace.
//
// Read verbs (GET/HEAD/OPTIONS) fall through — reading is the whole point of
// the demo account. Prisma-side defense-in-depth lives in
// `DemoReadOnlyExtension`, chained onto both `.forTenant()` and `.forSystem()`.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class DemoReadOnlyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { workspaceContext?: WorkspaceContext; user?: JwtUser }>();
    if (SAFE_METHODS.has((req.method ?? '').toUpperCase())) return true;

    const isDemoIdentity = req.user?.isDemo === true;
    const isDemoRole = req.workspaceContext?.role === 'DEMO_VIEWER';
    if (!isDemoIdentity && !isDemoRole) return true;

    throw new ForbiddenException({
      type: 'https://tasker.dev/problems/demo-read-only',
      title: 'Read-only demo',
      detail:
        'This account is the public read-only demo. Sign up for your own workspace to create, edit, or delete resources.',
      status: 403,
    });
  }
}
