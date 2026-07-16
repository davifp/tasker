import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessTokenPayload } from '../../common/security/token.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtUser {
  userId: string;
  sessionId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // The access JWT is stateless and lives for ~15 min. Without checking the
  // referenced session on every request, logout and admin-triggered
  // revocation would only take effect after the token naturally expires —
  // PRD FR-16 says revocation must be immediate. Trade off: one indexed
  // Prisma lookup per authenticated request.
  async validate(payload: AccessTokenPayload): Promise<JwtUser> {
    const session = await this.prisma.forSystem().session.findUnique({
      where: { id: payload.sid },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('Session no longer exists');
    }
    if (session.revokedAt) {
      throw new UnauthorizedException('Session has been revoked');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session has expired');
    }
    return { userId: payload.sub, sessionId: payload.sid };
  }
}
