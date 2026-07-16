import { Body, Controller, HttpCode, HttpStatus, Post, Request, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { RegisterDto } from '../users/dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthService } from './auth.service';
import { SessionsService } from '../sessions/sessions.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtUser } from './strategies/jwt.strategy';
import { User } from '@prisma/client';

function resolveDevice(req: ExpressRequest) {
  return {
    deviceLabel: req.headers['user-agent'] ?? 'unknown',
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Post('register')
  @Public()
  @Throttle({ register: {} })
  async register(@Body() dto: RegisterDto, @Request() req: ExpressRequest) {
    return this.authService.register({
      email: dto.email,
      password: dto.password,
      displayName: dto.displayName,
      device: resolveDevice(req),
    });
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ login: {} })
  @UseGuards(LocalAuthGuard)
  async login(@Request() req: ExpressRequest & { user: User }) {
    return this.authService.login(req.user, resolveDevice(req), req.ip);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ refresh: {} })
  async refresh(@Body() dto: RefreshDto, @Request() req: ExpressRequest) {
    const { access, refresh } = await this.sessions.rotate(dto.refreshToken, resolveDevice(req));
    return { accessToken: access, refreshToken: refresh };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipThrottle({ register: true, login: true, refresh: true })
  async logout(@Request() req: ExpressRequest & { user: JwtUser }) {
    return this.authService.logout(req.user.userId, req.user.sessionId);
  }
}
