import { Global, Module } from '@nestjs/common';
import { S3StorageAdapter } from './s3-storage.adapter';
import { StorageService } from './storage.service';

/**
 * Global module so any feature can `@Inject(StorageService)` without importing
 * this module explicitly — mirrors the pattern used by RedisModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useClass: S3StorageAdapter,
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
