import { Controller, ForbiddenException, Get, Param, Query, Request } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

@Controller('workspaces/:slug/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async find(
    @Param('slug') slug: string,
    @Query() query: SearchQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.search.query({
      workspaceId: ctx.workspaceId,
      workspaceSlug: slug,
      q: query.q,
      types: query.type,
      projectId: query.projectId,
      authorUserId: query.authorUserId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
