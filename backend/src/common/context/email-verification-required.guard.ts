import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtUser } from '../../auth/strategies/jwt.strategy';

@Injectable()
export class EmailVerificationRequiredGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const user = req.user;

    if (!user) return false;

    const dbUser = await this.prisma.forSystem().user.findUnique({
      where: { id: user.userId },
      select: { emailVerifiedAt: true },
    });

    if (!dbUser?.emailVerifiedAt) {
      throw new ForbiddenException({
        type: 'https://tasker.dev/problems/email-verification-required',
        title: 'Email Verification Required',
        detail: 'You must verify your email address before performing this action.',
        status: 403,
      });
    }

    return true;
  }
}
