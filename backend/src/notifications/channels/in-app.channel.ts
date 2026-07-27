import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { RealtimeEmitter } from '../../realtime/realtime.emitter';

// The in-app channel is not "delivered" in the traditional sense — the row
// itself is the delivery — so this class stays thin. Emit is separated so
// the notifications processor can call it as a per-channel worker even
// though the row already exists at that point.
@Injectable()
export class InAppChannel {
  private readonly logger = new Logger(InAppChannel.name);

  constructor(private readonly realtime: RealtimeEmitter) {}

  async deliver(notification: Notification): Promise<void> {
    await this.realtime.emit({
      type: 'notification.new',
      workspaceId: notification.workspaceId,
      recipientUserId: notification.recipientUserId,
      notificationId: notification.id,
    });
    this.logger.log(
      {
        notificationId: notification.id,
        recipientUserId: notification.recipientUserId,
        eventType: notification.eventType,
      },
      'notifications.in_app.delivered',
    );
  }
}
