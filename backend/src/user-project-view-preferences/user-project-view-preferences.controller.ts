import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { ProjectsService } from '../projects/projects.service';
import { UpdateViewPreferencesDto } from './dto/view-preferences.dto';
import { UserProjectViewPreferencesService } from './user-project-view-preferences.service';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

// Routes are per-user-per-project preferences. The pair `(userId, projectId)`
// is resolved from the authenticated JWT + the URL, so a member of workspace
// A cannot spoof workspace B's project or another user's row — the
// WorkspaceGuard already ensured the caller belongs to `:slug`, and the
// project lookup narrows to a project that belongs to that workspace.
//
// No `@Roles(...)` decorator: any workspace member (including GUEST) may
// read/write their own preferences. The routes are intentionally personal —
// a GUEST who cannot mutate tasks can still remember which view they last
// used.
@Controller('workspaces/:slug/projects/:projectSlug/me/view-preferences')
export class UserProjectViewPreferencesController {
  constructor(
    private readonly prefs: UserProjectViewPreferencesService,
    private readonly projects: ProjectsService,
  ) {}

  // Never 404 for a missing preferences row — returns an empty object
  // instead. The frontend depends on this contract for its first-visit
  // rendering path.
  @Get()
  async get(
    @Param('projectSlug') projectSlug: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    return this.prefs.getFor(ctx.userId, project.id);
  }

  // Shallow-merges the body into the stored row (or creates one) and returns
  // the merged payload. `PUT` is idempotent by definition — repeating the
  // same body is a no-op beyond bumping `updatedAt`.
  @Put()
  async put(
    @Param('projectSlug') projectSlug: string,
    @Body() dto: UpdateViewPreferencesDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const project = await this.projects.findBySlug(ctx.workspaceId, projectSlug);
    if (!project) throw new NotFoundException('Project not found');
    return this.prefs.upsert(ctx.userId, project.id, dto);
  }
}
