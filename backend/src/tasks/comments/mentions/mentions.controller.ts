import { Controller, ForbiddenException, Get, Query, Request } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import type { Request as ExpressRequest } from 'express';
import { mentionAutocompleteQuerySchema } from '@tasker/config';
import { WorkspaceContext } from '../../../common/context/workspace-context.store';
import { MentionsService } from './mentions.service';

class MentionSearchQueryDto extends createZodDto(mentionAutocompleteQuerySchema) {}

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

/**
 * Workspace-scoped member autocomplete for the mention popover. Route lives
 * under `/workspaces/:slug/members/mention-search` so `WorkspaceGuard` runs
 * on the URL slug — this makes cross-tenant lookups impossible even if the
 * caller supplies a fabricated `q`.
 */
@Controller('workspaces/:slug/members')
export class MentionsController {
  constructor(private readonly mentions: MentionsService) {}

  @Get('mention-search')
  async search(
    @Query() query: MentionSearchQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.mentions.search(ctx.workspaceId, query.q, query.limit);
  }
}
