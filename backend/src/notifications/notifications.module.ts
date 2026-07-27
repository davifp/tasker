import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NOTIFICATIONS_QUEUE } from '../queues/constants';
import { NotificationsService } from './notifications.service';
import { PreferencesService } from './preferences.service';
import { InAppChannel } from './channels/in-app.channel';
import { NotificationsController } from './notifications.controller';
import { PreferencesController } from './preferences.controller';

// RealtimeModule is imported for RealtimeEmitter (in-app WS emit) and
// RedisConnectionFactory (dedupe SETNX in NotificationsService). The
// notifications BullMQ queue is shared with the processor registered in
// BullMQModule — registerQueue is dedup-safe across modules by name.
@Module({
  imports: [PrismaModule, RealtimeModule, BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [NotificationsController, PreferencesController],
  providers: [NotificationsService, PreferencesService, InAppChannel],
  exports: [NotificationsService, PreferencesService],
})
export class NotificationsModule {}
