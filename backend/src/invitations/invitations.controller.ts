import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { Idempotent } from '../common/idempotency/idempotency.decorators';
import { Roles } from '../common/context/roles.decorator';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { UsersService } from '../users/users.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationsService } from './invitations.service';

// Workspace-scoped invitation management: routes below /workspaces/:slug/invitations.
@Controller('workspaces/:slug/invitations')
export class WorkspaceInvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly workspaces: WorkspacesService,
    private readonly users: UsersService,
  ) {}

  @Post()
  @Roles('ADMIN')
  @Idempotent()
  async createInvitation(
    @Param('slug') slug: string,
    @Body() dto: CreateInvitationDto,
    @Request() req: ExpressRequest & { user: JwtUser; workspaceContext?: WorkspaceContext },
  ) {
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    const inviter = await this.users.findById(req.user.userId);
    return this.invitations.createInvitation({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      email: dto.email,
      role: dto.role,
      invitedByUserId: req.user.userId,
      inviterName: inviter?.displayName ?? 'A workspace admin',
    });
  }

  @Get()
  @Roles('ADMIN')
  async listInvitations(@Param('slug') slug: string) {
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    return this.invitations.listInvitations(workspace.id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param('slug') slug: string, @Param('id') invitationId: string) {
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    await this.invitations.revoke(invitationId, workspace.id);
  }
}

// Public token routes: /invitations/:token/{accept,decline}.
// Accept requires the caller to be authenticated (JWT); decline is fully public
// so a wrong-address recipient can decline without creating an account.
@Controller('invitations')
export class PublicInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post(':token/accept')
  async accept(@Param('token') token: string, @Request() req: ExpressRequest & { user: JwtUser }) {
    return this.invitations.acceptInvitation(token, req.user.userId);
  }

  @Post(':token/decline')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async decline(@Param('token') token: string) {
    await this.invitations.declineInvitation(token);
  }
}
