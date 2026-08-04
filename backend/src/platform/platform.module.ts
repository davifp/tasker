import { Module } from '@nestjs/common';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PublicModule } from './public/public.module';
import { RateLimitingModule } from './rate-limiting/rate-limiting.module';

@Module({
  imports: [ApiKeysModule, RateLimitingModule, PublicModule],
  exports: [ApiKeysModule, RateLimitingModule],
})
export class PlatformModule {}
