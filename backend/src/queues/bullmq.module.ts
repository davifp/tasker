import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../common/mail/mail.module';
import { MailProcessor } from './mail.processor';
import { CleanupProcessor } from './cleanup.processor';
import { CLEANUP_QUEUE, MAIL_QUEUE, METRICS_QUEUE, NOTIFICATIONS_QUEUE } from './constants';

// The notifications queue is registered here so producers everywhere can
// inject it. The consumer worker (`NotificationsProcessor`) lives in
// `NotificationsModule` because it depends on the notifications domain
// services (EmailChannel, EmailBatcher, PreferencesService).
@Module({
  imports: [
    BullModule.registerQueue(
      { name: MAIL_QUEUE },
      { name: CLEANUP_QUEUE },
      { name: NOTIFICATIONS_QUEUE },
      { name: METRICS_QUEUE },
    ),
    PrismaModule,
    MailModule,
  ],
  providers: [MailProcessor, CleanupProcessor],
  exports: [BullModule],
})
export class BullMQModule {}
