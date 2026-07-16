import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '@tasker/config';

@Global()
@Module({
  providers: [
    {
      provide: Redis,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Redis(config.get('REDIS_URL'), { lazyConnect: true, maxRetriesPerRequest: 1 }),
    },
  ],
  exports: [Redis],
})
export class RedisModule {}
