import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import type { Env } from '@tasker/config';
import { realtimeTicketClaimsSchema } from '@tasker/config';
import { RedisConnectionFactory } from '../common/redis/redis-connection.factory';

// Redis key prefix for jti storage. Presence of the key means the ticket is
// still redeemable; deleting it consumes the ticket.
const JTI_KEY_PREFIX = 'rt:ticket:jti:';

// One-shot WebSocket handshake credential. The JWT is signed with a
// dedicated secret (rotate `RT_TICKET_SECRET` to invalidate all in-flight
// tickets without touching JWT sessions). The `jti` is stored in Redis with
// the ticket TTL and burned on first successful verification.
@Injectable()
export class RealtimeTicketService {
  private readonly ttlSeconds: number;
  private readonly redis: Redis;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    factory: RedisConnectionFactory,
  ) {
    this.ttlSeconds = this.config.get('RT_TICKET_TTL_S', { infer: true });
    this.redis = factory.create();
  }

  async mint(userId: string): Promise<{ ticket: string; expiresAt: Date }> {
    const jti = randomBytes(16).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.ttlSeconds;
    // Let jsonwebtoken populate `iat`, `exp`, and `aud` from the sign options
    // — that way we avoid clashes between payload keys and reserved claims.
    const ticket = this.jwt.sign(
      { sub: userId, jti },
      {
        secret: this.config.get('RT_TICKET_SECRET'),
        audience: 'rt-ticket',
        expiresIn: this.ttlSeconds,
      },
    );
    // Burn key TTL matches the JWT so cleanup is automatic if the ticket is
    // never redeemed. `SET NX PX` fails if the jti collides (astronomically
    // unlikely) so the caller cannot mint two tickets with the same jti.
    const stored = await this.redis.set(
      `${JTI_KEY_PREFIX}${jti}`,
      userId,
      'PX',
      this.ttlSeconds * 1000,
      'NX',
    );
    if (stored !== 'OK') {
      throw new Error('Ticket jti collision — retry mint');
    }
    return { ticket, expiresAt: new Date(exp * 1000) };
  }

  async verifyAndConsume(ticket: string): Promise<{ userId: string }> {
    let decoded: unknown;
    try {
      decoded = this.jwt.verify(ticket, {
        secret: this.config.get('RT_TICKET_SECRET'),
        audience: 'rt-ticket',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired realtime ticket');
    }
    const parsed = realtimeTicketClaimsSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new UnauthorizedException('Malformed realtime ticket claims');
    }
    const { sub: userId, jti } = parsed.data;
    // Atomically burn the jti — a replay races against DEL and loses. Result
    // is the number of keys deleted; 0 means the ticket was already consumed
    // or expired.
    const deleted = await this.redis.del(`${JTI_KEY_PREFIX}${jti}`);
    if (deleted === 0) {
      throw new UnauthorizedException('Realtime ticket already consumed');
    }
    return { userId };
  }
}
