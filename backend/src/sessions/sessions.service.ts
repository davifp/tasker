import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Session } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../common/security/token.service';
import {
  AuthEvents,
  RefreshRotatedEvent,
  SessionReuseDetectedEvent,
  SessionRevokedEvent,
} from '../auth/events/auth.events';

export interface DeviceMeta {
  deviceLabel: string;
  userAgent?: string;
  ip?: string;
}

const SESSION_ID_SEPARATOR = '.';

@Injectable()
export class SessionsService {
  private readonly sessionTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.sessionTtlDays = this.config.get<number>('SESSION_TTL_DAYS', 30);
  }

  async create(userId: string, device: DeviceMeta): Promise<{ session: Session; refresh: string }> {
    const { token: rawToken, hash } = this.tokenService.generateToken();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.sessionTtlDays);

    const session = await this.prisma.forSystem().session.create({
      data: {
        userId,
        refreshHash: hash,
        deviceLabel: device.deviceLabel,
        userAgent: device.userAgent,
        ip: device.ip,
        lastUsedAt: new Date(),
        expiresAt,
      },
    });

    // Full refresh token encodes sessionId for reuse detection
    const refresh = `${session.id}${SESSION_ID_SEPARATOR}${rawToken}`;
    return { session, refresh };
  }

  async rotate(refresh: string, device: DeviceMeta): Promise<{ access: string; refresh: string }> {
    const separatorIndex = refresh.indexOf(SESSION_ID_SEPARATOR);
    if (separatorIndex === -1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const sessionId = refresh.slice(0, separatorIndex);
    const rawToken = refresh.slice(separatorIndex + 1);

    const session = await this.prisma.forSystem().session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    const expectedHash = this.tokenService.hash(rawToken);

    // Hash mismatch means this token was already rotated — reuse attack
    if (session.refreshHash !== expectedHash) {
      if (!session.revokedAt) {
        await this.prisma.forSystem().session.update({
          where: { id: sessionId },
          data: { revokedAt: new Date() },
        });
      }
      this.events.emit(AuthEvents.REUSE_DETECTED, {
        userId: session.userId,
        sessionId,
        ip: device.ip,
      } satisfies SessionReuseDetectedEvent);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (session.revokedAt) {
      throw new UnauthorizedException('Session has been revoked');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session has expired');
    }

    const { token: newRawToken, hash: newHash } = this.tokenService.generateToken();

    // Atomic compare-and-swap: only updates if the hash hasn't changed since we read it.
    // If two concurrent requests race past the hash check above, exactly one wins here;
    // the other gets count=0 and is rejected as a concurrent rotation attempt.
    const updated = await this.prisma.forSystem().session.updateMany({
      where: { id: sessionId, refreshHash: expectedHash },
      data: {
        refreshHash: newHash,
        lastUsedAt: new Date(),
        deviceLabel: device.deviceLabel,
        userAgent: device.userAgent,
        ip: device.ip,
      },
    });

    if (updated.count === 0) {
      throw new UnauthorizedException('Session was concurrently rotated');
    }

    const access = this.tokenService.signAccess({ sub: session.userId, sid: sessionId });
    const newRefresh = `${sessionId}${SESSION_ID_SEPARATOR}${newRawToken}`;

    this.events.emit(AuthEvents.REFRESH_ROTATED, {
      userId: session.userId,
      sessionId,
    } satisfies RefreshRotatedEvent);

    return { access, refresh: newRefresh };
  }

  async revoke(sessionId: string, actorUserId: string): Promise<void> {
    const session = await this.prisma.forSystem().session.findUnique({
      where: { id: sessionId },
    });

    if (!session) return;
    // Defense-in-depth: refuse to revoke a session that belongs to another
    // user, even though every current caller pre-checks ownership. Keeps a
    // future refactor from accidentally handing out a foot-gun.
    if (session.userId !== actorUserId) {
      throw new ForbiddenException('You cannot revoke another user’s session');
    }
    if (session.revokedAt) return;

    await this.prisma.forSystem().session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    this.events.emit(AuthEvents.SESSION_REVOKED, {
      userId: session.userId,
      sessionId,
      actorUserId,
    } satisfies SessionRevokedEvent);
  }

  list(userId: string): Promise<Session[]> {
    return this.prisma.forSystem().session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async findForUser(sessionId: string, userId: string): Promise<Session | null> {
    const session = await this.prisma.forSystem().session.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId) return null;
    return session;
  }
}
