import { Module } from '@nestjs/common';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { PublicModule } from './public/public.module';
import { RateLimitingModule } from './rate-limiting/rate-limiting.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [ApiKeysModule, RateLimitingModule, PublicModule, WebhooksModule, IntegrationsModule],
  exports: [ApiKeysModule, RateLimitingModule, WebhooksModule, IntegrationsModule],
})
export class PlatformModule {}
