import { BadRequestException, GoneException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../common/security/token.service';
import { MAIL_PROVIDER, MailProvider } from '../common/mail/mail.provider';

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly config: ConfigService,
  ) {}

  async sendVerificationEmail(userId: string, email: string): Promise<void> {
    // Consume any existing unexpired tokens so only the latest is valid
    await this.prisma.forSystem().emailVerificationToken.updateMany({
      where: { userId, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    const { token, hash } = this.tokenService.generateToken();
    const ttlS = this.config.get<number>('EMAIL_VERIFY_TTL_S', 86400);
    const expiresAt = new Date(Date.now() + ttlS * 1000);

    await this.prisma.forSystem().emailVerificationToken.create({
      data: { userId, tokenHash: hash, expiresAt },
    });

    const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3000');
    const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

    await this.mail.send({
      template: 'email-verify',
      to: email,
      variables: { verifyUrl },
      idempotencyKey: `email-verify-${userId}-${hash.slice(0, 16)}`,
    });
  }

  async verify(rawToken: string): Promise<void> {
    const hash = this.tokenService.hash(rawToken);
    const record = await this.prisma.forSystem().emailVerificationToken.findUnique({
      where: { tokenHash: hash },
    });

    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw new GoneException('Verification token is invalid, expired, or has already been used');
    }

    await this.prisma.forSystem().$transaction([
      this.prisma.forSystem().emailVerificationToken.update({
        where: { tokenHash: hash },
        data: { consumedAt: new Date() },
      }),
      this.prisma.forSystem().user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
  }

  async resend(userId: string): Promise<void> {
    const user = await this.prisma.forSystem().user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.emailVerifiedAt) throw new BadRequestException('Email is already verified');
    await this.sendVerificationEmail(userId, user.email);
  }
}
