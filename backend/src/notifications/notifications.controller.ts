import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { WorkspaceContext } from '../common/context/workspace-context.store';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/notifications.dto';

function requireCtx(
  req: ExpressRequest & { workspaceContext?: WorkspaceContext },
): WorkspaceContext {
  if (!req.workspaceContext) {
    throw new ForbiddenException('Workspace context not resolved');
  }
  return req.workspaceContext;
}

// WorkspaceGuard triggers on the `X-Workspace-Id` header the frontend attaches
// to every authenticated request, so these endpoints do not need a `:slug`
// path param. All queries are scoped to (recipientUserId, workspaceId) so
// switching workspaces on the client flips the bell counter cleanly.
// Cross-workspace aggregation is intentionally out of scope — the bell is
// per-workspace by design.
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @Query() query: ListNotificationsQueryDto,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    return this.notifications.list(ctx.userId, ctx.workspaceId, {
      cursor: query.cursor,
      limit: query.limit,
      unreadOnly: query.unreadOnly,
      type: query.type,
    });
  }

  @Get('unread-count')
  async unreadCount(@Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext }) {
    const ctx = requireCtx(req);
    const count = await this.notifications.unreadCount(ctx.userId, ctx.workspaceId);
    return { count };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @Param('id') id: string,
    @Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext },
  ) {
    const ctx = requireCtx(req);
    const updated = await this.notifications.markRead(id, ctx.userId, ctx.workspaceId);
    if (!updated) throw new NotFoundException('Notification not found');
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@Request() req: ExpressRequest & { workspaceContext?: WorkspaceContext }) {
    const ctx = requireCtx(req);
    return this.notifications.markAllRead(ctx.userId, ctx.workspaceId);
  }
}
