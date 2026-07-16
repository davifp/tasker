import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MAIL_PROVIDER } from './mail.provider';
import { QueuedMailAdapter } from './queued-mail.adapter';
import { MAIL_QUEUE } from '../../queues/constants';

@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [QueuedMailAdapter, { provide: MAIL_PROVIDER, useExisting: QueuedMailAdapter }],
  exports: [MAIL_PROVIDER],
})
export class MailModule {}
