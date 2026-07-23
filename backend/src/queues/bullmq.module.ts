import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../common/mail/mail.module';
import { MailProcessor } from './mail.processor';
import { CleanupProcessor } from './cleanup.processor';
import { NotificationsProcessor } from './notifications.processor';
import { CLEANUP_QUEUE, MAIL_QUEUE, NOTIFICATIONS_QUEUE } from './constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: MAIL_QUEUE },
      { name: CLEANUP_QUEUE },
      { name: NOTIFICATIONS_QUEUE },
    ),
    PrismaModule,
    MailModule,
  ],
  providers: [MailProcessor, CleanupProcessor, NotificationsProcessor],
  exports: [BullModule],
})
export class BullMQModule {}
