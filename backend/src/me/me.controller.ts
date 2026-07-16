import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Request,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request as ExpressRequest } from 'express';
import { JwtUser } from '../auth/strategies/jwt.strategy';
import { UsersService } from '../users/users.service';
import { SessionsService } from '../sessions/sessions.service';

@SkipThrottle({ register: true, login: true, refresh: true })
@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  async getMe(@Request() req: ExpressRequest & { user: JwtUser }) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  @Get('sessions')
  getSessions(@Request() req: ExpressRequest & { user: JwtUser }) {
    return this.sessions.list(req.user.userId);
  }

  @Delete('sessions/:id')
  async revokeSession(@Param('id') id: string, @Request() req: ExpressRequest & { user: JwtUser }) {
    const session = await this.sessions.findForUser(id, req.user.userId);
    if (!session) throw new ForbiddenException('Session not found or does not belong to you');
    await this.sessions.revoke(id, req.user.userId);
  }

  @Get('workspaces')
  getWorkspaces(@Request() req: ExpressRequest & { user: JwtUser }) {
    return this.users.findWorkspaces(req.user.userId);
  }
}
