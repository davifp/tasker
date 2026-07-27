import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RealtimeTicketService } from './realtime.ticket.service';
import { RealtimeEmitter, userRoom } from './realtime.emitter';

interface JwtRequest {
  user: { userId: string; sessionId?: string };
}

// The realtime endpoints intentionally bypass WorkspaceGuard — the ticket is
// user-scoped and the workspaceId travels through the WS handshake instead.
// Ticket minting has its own throttler bucket so a compromised session cannot
// spam Redis with jti keys.
@Controller('realtime')
@UseGuards(JwtAuthGuard)
export class RealtimeController {
  constructor(
    private readonly tickets: RealtimeTicketService,
    private readonly emitter: RealtimeEmitter,
    private readonly config: ConfigService,
  ) {}

  @Post('ticket')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async mintTicket(@Req() req: JwtRequest): Promise<{ ticket: string; expiresAt: string }> {
    const { ticket, expiresAt } = await this.tickets.mint(req.user.userId);
    return { ticket, expiresAt: expiresAt.toISOString() };
  }

  // Smoke endpoint — emits a `test.ping` event to the caller's user room so
  // a developer can confirm the client provider is receiving events end-to-end.
  // Task 8.0 does not use it; kept behind SkipThrottle so a smoke script can
  // fire without eating the default bucket.
  @Get('ping')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipThrottle()
  ping(@Req() req: JwtRequest): void {
    this.emitter.emitRaw(userRoom(req.user.userId), 'test.ping', {
      at: new Date().toISOString(),
    });
  }

  // Web Push VAPID public key. Safe to serve to any authenticated caller —
  // the key is a public identifier; only the private counterpart must stay
  // server-side. Returned as JSON so the browser can pass it straight to
  // `pushManager.subscribe`.
  @Get('vapid-key')
  vapidKey(): { publicKey: string | null } {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY') ?? null;
    return { publicKey };
  }
}
