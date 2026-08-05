import { Module } from '@nestjs/common';
import { BullMQModule } from '../../queues/bullmq.module';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhookDispatcherListener } from './webhook-dispatcher.listener';
import { WebhookDlqProcessor } from './webhook-dlq.processor';
import { WebhookMetricsCollector } from './webhook.metrics';
import { webhookSignerProvider } from './webhook-signer.provider';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [BullMQModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    webhookSignerProvider,
    WebhookDispatcherListener,
    WebhookDeliveryProcessor,
    WebhookDlqProcessor,
    WebhookMetricsCollector,
  ],
  exports: [WebhooksService, WebhookMetricsCollector],
})
export class WebhooksModule {}
