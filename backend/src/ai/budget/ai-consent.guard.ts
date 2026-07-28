import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { WorkspaceContext } from '../../common/context/workspace-context.store';
import { AI_CONSENT_SKIP_KEY } from './ai-consent.decorator';
import { AiConsentService } from './ai-consent.service';

/**
 * Route-level guard that blocks every AI action for a workspace that has
 * not accepted the AI data-sharing consent document (or has accepted an
 * older version — see `AI_CONSENT_DOCUMENT_VERSION`).
 *
 * Registered inside `AiModule` at the controller level so it does NOT run
 * for non-AI routes (the app-level `WorkspaceGuard` already fires on any
 * workspace-scoped path). Route handlers that must remain reachable pre-
 * consent — the `/consent` endpoints themselves, and the `/usage` peek —
 * opt out with `@SkipAiConsent()`.
 */
@Injectable()
export class AiConsentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly consent: AiConsentService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(AI_CONSENT_SKIP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { workspaceContext?: WorkspaceContext }>();
    const ctx = req.workspaceContext;
    if (!ctx) {
      // Reached without a workspace context — surface it as a Forbidden
      // rather than a silent pass; upstream guards should have rejected.
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/workspace-context-missing',
        title: 'Workspace context required',
        detail: 'AI actions require a workspace context resolved by WorkspaceGuard.',
        status: 403,
      });
    }

    const accepted = await this.consent.isCurrentlyAccepted(ctx.workspaceId);
    if (accepted) return true;

    throw new ForbiddenException({
      type: 'about:blank#ai-consent-required',
      title: 'AI data-sharing consent required',
      detail:
        'An admin must accept the AI data-sharing consent for this workspace ' +
        'before AI actions become available.',
      status: 403,
    });
  }
}
