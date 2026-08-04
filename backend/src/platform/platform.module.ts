import { Module } from '@nestjs/common';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { RateLimitingModule } from './rate-limiting/rate-limiting.module';

@Module({
  imports: [ApiKeysModule, RateLimitingModule],
  exports: [ApiKeysModule, RateLimitingModule],
})
export class PlatformModule {}
