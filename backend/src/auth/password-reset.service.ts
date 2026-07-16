import { BadRequestException, GoneException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../common/security/token.service';
import { Argon2Service } from '../common/security/argon2.service';
import { HibpService } from '../common/security/hibp.service';
import { MAIL_PROVIDER, MailProvider } from '../common/mail/mail.provider';
import {
  AuthEvents,
  PasswordResetCompletedEvent,
  PasswordResetRequestedEvent,
} from './events/auth.events';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly argon2: Argon2Service,
    private readonly hibp: HibpService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async requestReset(email: string): Promise<void> {
    const user = await this.prisma.forSystem().user.findUnique({ where: { email } });

    // Always return 202 — no enumeration
    if (!user) {
      this.logger.warn({ email }, 'Password reset requested for unknown email');
      return;
    }

    // Expire any existing unexpired reset tokens
    await this.prisma.forSystem().passwordResetToken.updateMany({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    const { token, hash } = this.tokenService.generateToken();
    const ttlS = this.config.get<number>('PASSWORD_RESET_TTL_S', 3600);
    const expiresAt = new Date(Date.now() + ttlS * 1000);

    await this.prisma.forSystem().passwordResetToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt },
    });

    const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3000');
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Mail enqueue failure must not turn a "known email" branch into a 5xx —
    // that would leak account existence via the status code. Swallow + log.
    try {
      await this.mail.send({
        template: 'password-reset',
        to: email,
        variables: { resetUrl },
        idempotencyKey: `password-reset-${user.id}-${hash.slice(0, 16)}`,
      });
    } catch (err) {
      this.logger.error({ err, userId: user.id }, 'Failed to enqueue password-reset email');
    }

    this.events.emit(AuthEvents.PASSWORD_RESET_REQUESTED, {
      userId: user.id,
      email: user.email,
    } satisfies PasswordResetRequestedEvent);
  }

  async confirmReset(rawToken: string, newPassword: string): Promise<void> {
    const hash = this.tokenService.hash(rawToken);
    const record = await this.prisma.forSystem().passwordResetToken.findUnique({
      where: { tokenHash: hash },
    });

    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw new GoneException('Reset token is invalid, expired, or has already been used');
    }

    // Additional breach check on reset — registration enforces this; a leaked
    // password shouldn't be re-usable via the reset path either.
    if (await this.hibp.isBreached(newPassword)) {
      throw new BadRequestException(
        'This password has appeared in a data breach. Please choose a different password.',
      );
    }

    const passwordHash = await this.argon2.hash(newPassword);

    // Atomic compare-and-swap consumes the token exactly once. Two concurrent
    // confirmReset calls with the same raw token both pass the check above,
    // but only one wins the updateMany — the other sees count=0 and is
    // rejected as if the token were already spent.
    const consumed = await this.prisma.forSystem().passwordResetToken.updateMany({
      where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new GoneException('Reset token is invalid, expired, or has already been used');
    }

    // Password update and session revocation must be atomic — if the session
    // sweep fails, we cannot leave the new password committed with stale
    // refresh tokens still valid.
    const [, sessionSweep] = await this.prisma.forSystem().$transaction([
      this.prisma.forSystem().user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.forSystem().session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.events.emit(AuthEvents.PASSWORD_RESET_COMPLETED, {
      userId: record.userId,
      revokedSessionCount: sessionSweep.count,
    } satisfies PasswordResetCompletedEvent);
  }
}
