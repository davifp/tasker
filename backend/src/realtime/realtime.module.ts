import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Env } from '@tasker/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisConnectionFactory } from '../common/redis/redis-connection.factory';
import { RealtimeTicketService } from './realtime.ticket.service';
import { RealtimeEmitter } from './realtime.emitter';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeController } from './realtime.controller';
import { WsAuthGuard } from './ws-auth.guard';
import { WsWorkspaceGuard } from './ws-workspace.guard';

// Dedicated JwtModule instance because the WS ticket is signed with
// RT_TICKET_SECRET, not the JWT_SECRET used by the session access token.
// This way rotating one does not invalidate the other.
@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('RT_TICKET_SECRET'),
      }),
    }),
  ],
  controllers: [RealtimeController],
  providers: [
    RedisConnectionFactory,
    RealtimeTicketService,
    RealtimeEmitter,
    RealtimeGateway,
    WsAuthGuard,
    WsWorkspaceGuard,
  ],
  exports: [RealtimeEmitter, RedisConnectionFactory],
})
export class RealtimeModule {}
