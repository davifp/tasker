import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedSocketData, SOCKET_USER_KEY } from './ws-auth.guard';

// Reads the workspaceId from socket.data (set at handshake). Verifies the
// authenticated user is still a member — a role change during the WS session
// takes effect on the next subscribe message, matching the REST behavior of
// WorkspaceGuard.
@Injectable()
export class WsWorkspaceGuard implements CanActivate {
  private readonly logger = new Logger(WsWorkspaceGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const socket = context.switchToWs().getClient<Socket>();
    const user = (socket.data as AuthenticatedSocketData)[SOCKET_USER_KEY];
    const workspaceId = (socket.data as { workspaceId?: string }).workspaceId;
    if (!user?.userId || !workspaceId) {
      throw new WsException('Missing workspace context');
    }
    const member = await this.prisma.forSystem().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.userId } },
      select: { id: true },
    });
    if (!member) {
      this.logger.warn(
        { socketId: socket.id, userId: user.userId, workspaceId },
        'WS subscribe rejected — non-member',
      );
      throw new WsException('Not a workspace member');
    }
    return true;
  }
}
