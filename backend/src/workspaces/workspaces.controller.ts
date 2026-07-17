import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { EmailVerificationRequiredGuard } from '../common/context/email-verification-required.guard';
import { Idempotent } from '../common/idempotency/idempotency.decorators';
import { Roles } from '../common/context/roles.decorator';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { JwtUser } from '../auth/strategies/jwt.strategy';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { WorkspacesService } from './workspaces.service';

@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post('workspaces')
  @UseGuards(EmailVerificationRequiredGuard)
  @Idempotent()
  createWorkspace(
    @Body() dto: CreateWorkspaceDto,
    @Request() req: ExpressRequest & { user: JwtUser },
  ) {
    return this.workspaces.createWorkspace({
      name: dto.name,
      slug: dto.slug,
      ownerUserId: req.user.userId,
    });
  }

  @Get('workspaces/:slug')
  async getWorkspace(
    @Param('slug') slug: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    return { ...workspace, currentUserRole: req.workspaceContext?.role };
  }

  @Patch('workspaces/:slug')
  @Roles('ADMIN')
  async updateWorkspace(@Param('slug') slug: string, @Body() dto: UpdateWorkspaceDto) {
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    return this.workspaces.updateWorkspace(workspace.id, dto);
  }

  @Delete('workspaces/:slug')
  @Roles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorkspace(
    @Param('slug') slug: string,
    @Request() req: ExpressRequest & { user: JwtUser; workspaceContext?: WorkspaceContext },
  ) {
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    const ctx = requireCtx(req);
    await this.workspaces.softDelete({ workspaceId: workspace.id, actorUserId: ctx.userId });
  }

  @Post('workspaces/:slug/restore')
  @Roles('OWNER')
  async restoreWorkspace(
    @Param('slug') slug: string,
    @Request() req: ExpressRequest & { user: JwtUser; workspaceContext?: WorkspaceContext },
  ) {
    const workspace = await this.workspaces.findBySlug(slug, true);
    if (!workspace) throw new NotFoundException('Workspace not found');
    const ctx = requireCtx(req);
    return this.workspaces.restore({ workspaceId: workspace.id, actorUserId: ctx.userId });
  }

  @Post('workspaces/:slug/transfer-ownership')
  @Roles('OWNER')
  async transferOwnership(
    @Param('slug') slug: string,
    @Body() dto: TransferOwnershipDto,
    @Request() req: ExpressRequest & { user: JwtUser; workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    return this.workspaces.transferOwnership({
      workspaceId: workspace.id,
      currentOwnerUserId: ctx.userId,
      newOwnerUserId: dto.newOwnerUserId,
    });
  }

  @Get('workspaces/:slug/members')
  async listMembers(
    @Param('slug') slug: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    return this.workspaces.listMembers(workspace.id, {
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch('workspaces/:slug/members/:userId')
  @Roles('ADMIN')
  async updateMember(
    @Param('slug') slug: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
    @Request() req: ExpressRequest & { user: JwtUser; workspaceContext?: WorkspaceContext },
  ) {
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    const ctx = requireCtx(req);
    return this.workspaces.updateMemberRole({
      workspaceId: workspace.id,
      targetUserId: userId,
      newRole: dto.role,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
    });
  }

  @Delete('workspaces/:slug/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('slug') slug: string,
    @Param('userId') targetUserId: string,
    @Request() req: ExpressRequest & { user: JwtUser; workspaceContext?: WorkspaceContext },
  ) {
    const workspace = await this.workspaces.findBySlug(slug);
    if (!workspace) throw new NotFoundException('Workspace not found');
    const ctx = requireCtx(req);
    const isSelfLeave = targetUserId === ctx.userId;
    if (!isSelfLeave && ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') {
      throw new ForbiddenException('Only Owners and Admins can remove other members');
    }
    if (isSelfLeave && ctx.role === 'OWNER') {
      throw new BadRequestException('Owner cannot leave the workspace — transfer ownership first');
    }
    await this.workspaces.removeMember({
      workspaceId: workspace.id,
      targetUserId,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
    });
  }
}
