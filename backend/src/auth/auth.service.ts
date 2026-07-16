import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { Argon2Service } from '../common/security/argon2.service';
import { HibpService } from '../common/security/hibp.service';
import { TokenService } from '../common/security/token.service';
import { SessionsService, DeviceMeta } from '../sessions/sessions.service';
import {
  AuthEvents,
  LoginFailedEvent,
  LoginSuccessEvent,
  LogoutEvent,
  UserRegisteredEvent,
} from './events/auth.events';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly argon2: Argon2Service,
    private readonly hibp: HibpService,
    private readonly tokenService: TokenService,
    private readonly sessions: SessionsService,
    private readonly events: EventEmitter2,
  ) {}

  async register(params: {
    email: string;
    password: string;
    displayName: string;
    device: DeviceMeta;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    const breached = await this.hibp.isBreached(params.password);
    if (breached) {
      throw new BadRequestException(
        'This password has appeared in a data breach. Please choose a different password.',
      );
    }

    const existing = await this.users.findByEmail(params.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const user = await this.users.createLocal({
      email: params.email,
      password: params.password,
      displayName: params.displayName,
    });

    this.events.emit(AuthEvents.USER_REGISTERED, {
      userId: user.id,
      email: user.email,
    } satisfies UserRegisteredEvent);

    return this.issueTokens(user, params.device);
  }

  // Called by LocalStrategy — returns null on failure (no enumeration)
  async validateCredentials(email: string, password: string): Promise<User | null> {
    const user = await this.users.findByEmail(email);

    // Always run argon2.verify to prevent timing-based enumeration
    const dummyHash =
      '$argon2id$v=19$m=19456,t=2,p=1$dummysaltdummysalt$dummyhashvaluedummyhashvaluedummyhash';
    const hash = user?.passwordHash ?? dummyHash;
    const valid = await this.argon2.verify(hash, password);

    if (!user || !valid || !user.passwordHash) {
      this.logger.warn({ email }, 'Login attempt failed');
      return null;
    }

    return user;
  }

  async login(
    user: User,
    device: DeviceMeta,
    ip?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    this.events.emit(AuthEvents.LOGIN_SUCCESS, {
      userId: user.id,
      ip,
    } satisfies LoginSuccessEvent);

    return this.issueTokens(user, device);
  }

  emitLoginFailed(email: string, ip?: string): void {
    this.events.emit(AuthEvents.LOGIN_FAILED, {
      email,
      reason: 'bad_credentials',
      ip,
    } satisfies LoginFailedEvent);
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, userId);
    this.events.emit(AuthEvents.LOGOUT, {
      userId,
      sessionId,
    } satisfies LogoutEvent);
  }

  private async issueTokens(
    user: User,
    device: DeviceMeta,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const { session, refresh } = await this.sessions.create(user.id, device);
    const access = this.tokenService.signAccess({ sub: user.id, sid: session.id });
    return { accessToken: access, refreshToken: refresh };
  }
}
