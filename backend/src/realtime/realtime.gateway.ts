import { Logger, UseGuards, UsePipes } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ZodValidationPipe } from 'nestjs-zod';
import { subscribeTaskMessageSchema, SubscribeTaskMessage } from '@tasker/config';
import { RealtimeTicketService } from './realtime.ticket.service';
import { RealtimeEmitter, taskRoom, userRoom, workspaceRoom } from './realtime.emitter';
import { SOCKET_USER_KEY } from './ws-auth.guard';
import { WsAuthGuard } from './ws-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { WsException } from '@nestjs/websockets';

// The workspace is provided by the client via handshake.auth.workspaceId so
// the ticket stays user-scoped (a user with two open workspaces gets two
// tickets, one per tab).
@WebSocketGateway({ transports: ['websocket'] })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tickets: RealtimeTicketService,
    private readonly emitter: RealtimeEmitter,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(): void {
    this.emitter.bind(this.server);
  }

  async handleConnection(socket: Socket): Promise<void> {
    const ticket = socket.handshake.auth?.['ticket'];
    const workspaceId = socket.handshake.auth?.['workspaceId'];
    if (typeof ticket !== 'string' || typeof workspaceId !== 'string' || !workspaceId) {
      this.logger.warn(
        { socketId: socket.id },
        'WS connect rejected — missing ticket or workspace',
      );
      socket.disconnect(true);
      return;
    }
    let userId: string;
    try {
      const redeemed = await this.tickets.verifyAndConsume(ticket);
      userId = redeemed.userId;
    } catch (err) {
      this.logger.warn({ socketId: socket.id, err }, 'WS connect rejected — ticket invalid');
      socket.disconnect(true);
      return;
    }
    // Enforce workspace membership at connection time so an attacker with a
    // valid ticket for their own user cannot subscribe to someone else's
    // workspace by faking the workspaceId.
    const member = await this.prisma.forSystem().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!member) {
      this.logger.warn(
        { socketId: socket.id, userId, workspaceId },
        'WS connect rejected — non-member',
      );
      socket.disconnect(true);
      return;
    }
    socket.data[SOCKET_USER_KEY] = { userId };
    (socket.data as { workspaceId?: string }).workspaceId = workspaceId;
    await socket.join([workspaceRoom(workspaceId), userRoom(userId)]);
    this.logger.log({ socketId: socket.id, userId, workspaceId }, 'realtime.connect');
  }

  handleDisconnect(socket: Socket): void {
    const user = (socket.data as { user?: { userId: string } }).user;
    this.logger.log({ socketId: socket.id, userId: user?.userId }, 'realtime.disconnect');
  }

  @UseGuards(WsAuthGuard)
  @UsePipes(new ZodValidationPipe(subscribeTaskMessageSchema))
  @SubscribeMessage('subscribe:task')
  async onSubscribeTask(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: SubscribeTaskMessage,
  ): Promise<{ ok: true }> {
    const workspaceId = (socket.data as { workspaceId?: string }).workspaceId;
    const user = (socket.data as { user?: { userId: string } }).user;
    if (!workspaceId || !user) {
      throw new WsException('Missing workspace context');
    }
    // Confirm the task belongs to the workspace the socket is scoped to.
    // Prevents subscribing to a task in another tenant by guessing an id.
    const task = await this.prisma.forSystem().task.findFirst({
      where: { id: body.taskId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!task) {
      throw new WsException('Task not found in workspace');
    }
    await socket.join(taskRoom(workspaceId, body.taskId));
    return { ok: true };
  }

  @UseGuards(WsAuthGuard)
  @UsePipes(new ZodValidationPipe(subscribeTaskMessageSchema))
  @SubscribeMessage('unsubscribe:task')
  async onUnsubscribeTask(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: SubscribeTaskMessage,
  ): Promise<{ ok: true }> {
    const workspaceId = (socket.data as { workspaceId?: string }).workspaceId;
    if (workspaceId) {
      await socket.leave(taskRoom(workspaceId, body.taskId));
    }
    return { ok: true };
  }
}
