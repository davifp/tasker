import { Injectable, Logger, Optional } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { RealtimeEmitter } from '../../realtime/realtime.emitter';
import { NotificationsMetricsCollector } from '../../metrics/notifications.metrics';

// The in-app channel is not "delivered" in the traditional sense — the row
// itself is the delivery — so this class stays thin. Emit is separated so
// the notifications processor can call it as a per-channel worker even
// though the row already exists at that point.
@Injectable()
export class InAppChannel {
  private readonly logger = new Logger(InAppChannel.name);

  constructor(
    private readonly realtime: RealtimeEmitter,
    @Optional() private readonly metrics?: NotificationsMetricsCollector,
  ) {}

  async deliver(notification: Notification): Promise<void> {
    try {
      await this.realtime.emit({
        type: 'notification.new',
        workspaceId: notification.workspaceId,
        recipientUserId: notification.recipientUserId,
        notificationId: notification.id,
      });
      this.metrics?.incrementDelivered('IN_APP', notification.eventType, 'success');
    } catch (err) {
      this.metrics?.incrementDelivered('IN_APP', notification.eventType, 'failure');
      throw err;
    }
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
