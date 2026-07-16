import { GoneException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../common/security/token.service';
import { Argon2Service } from '../common/security/argon2.service';
import { MAIL_PROVIDER, MailProvider } from '../common/mail/mail.provider';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly argon2: Argon2Service,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly config: ConfigService,
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

    await this.mail.send({
      template: 'password-reset',
      to: email,
      variables: { resetUrl },
      idempotencyKey: `password-reset-${user.id}-${hash.slice(0, 16)}`,
    });
  }

  async confirmReset(rawToken: string, newPassword: string): Promise<void> {
    const hash = this.tokenService.hash(rawToken);
    const record = await this.prisma.forSystem().passwordResetToken.findUnique({
      where: { tokenHash: hash },
    });

    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw new GoneException('Reset token is invalid, expired, or has already been used');
    }

    const passwordHash = await this.argon2.hash(newPassword);

    // Password update, token consumption, and session revocation must be atomic —
    // if the session sweep fails, we cannot leave the new password committed with
    // stale refresh tokens still valid.
    await this.prisma.forSystem().$transaction([
      this.prisma.forSystem().passwordResetToken.update({
        where: { tokenHash: hash },
        data: { consumedAt: new Date() },
      }),
      this.prisma.forSystem().user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.forSystem().session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }
}
