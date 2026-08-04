import { Module } from '@nestjs/common';
import { ApiKeysModule } from './api-keys/api-keys.module';

@Module({
  imports: [ApiKeysModule],
  exports: [ApiKeysModule],
})
export class PlatformModule {}
