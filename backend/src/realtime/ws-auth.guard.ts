import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

// Attached to the socket in RealtimeGateway.handleConnection after the ticket
// is redeemed. Any subsequent guard/handler reads the userId from here.
export const SOCKET_USER_KEY = 'user';

export interface AuthenticatedSocketData {
  [SOCKET_USER_KEY]?: { userId: string };
}

// Rejects any WS message that reaches a handler without an authenticated user
// attached to socket.data. The connection-time authentication happens inside
// the gateway (redeeming the one-shot ticket); this guard is the second line
// of defense so a bug in the connection handler cannot leak an unauthenticated
// socket to a @SubscribeMessage handler.
@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const socket = context.switchToWs().getClient<Socket>();
    const user = (socket.data as AuthenticatedSocketData)[SOCKET_USER_KEY];
    if (!user?.userId) {
      this.logger.warn({ socketId: socket.id }, 'Unauthenticated WS message rejected');
      throw new WsException('Unauthenticated');
    }
    return true;
  }
}
