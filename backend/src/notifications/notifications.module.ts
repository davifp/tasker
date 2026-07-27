import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MailModule } from '../common/mail/mail.module';
import { NOTIFICATIONS_QUEUE } from '../queues/constants';
import { NotificationsService } from './notifications.service';
import { PreferencesService } from './preferences.service';
import { InAppChannel } from './channels/in-app.channel';
import { EmailChannel } from './channels/email.channel';
import { EmailBatcher } from './channels/email-batcher.service';
import { PushChannel } from './channels/push.channel';
import { PushModule } from '../push/push.module';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsController } from './notifications.controller';
import { PreferencesController } from './preferences.controller';

// RealtimeModule is imported for RealtimeEmitter (in-app WS emit) and
// RedisConnectionFactory (dedupe SETNX + email bucket LPUSH). MailModule
// provides the MAIL_PROVIDER token that the batcher uses to enqueue
// transactional emails. The notifications BullMQ queue is shared with
// producers registered in BullMQModule — `registerQueue` is dedup-safe
// across modules by name.
@Module({
  imports: [
    PrismaModule,
    RealtimeModule,
    MailModule,
    PushModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [NotificationsController, PreferencesController],
  providers: [
    NotificationsService,
    PreferencesService,
    InAppChannel,
    EmailChannel,
    EmailBatcher,
    PushChannel,
    NotificationsProcessor,
  ],
  exports: [NotificationsService, PreferencesService],
})
export class NotificationsModule {}
