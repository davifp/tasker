import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { PushSubscriptionsController } from './push-subscriptions.controller';

// Deliberately kept lean — the sending side of push lives in
// `NotificationsModule` (`channels/push.channel.ts`) so it can share the
// same fan-out plumbing as the email channel. This module owns the CRUD
// surface for the `PushSubscription` table only.
@Module({
  imports: [PrismaModule],
  controllers: [PushSubscriptionsController],
  providers: [PushSubscriptionsService],
  exports: [PushSubscriptionsService],
})
export class PushModule {}
