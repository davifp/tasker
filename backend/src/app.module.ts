import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { envSchema } from '@tasker/config';
import { LoggerModule } from './common/logger/logger.module';
import { TraceIdMiddleware } from './common/middleware/trace-id.middleware';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './common/redis/redis.module';
import { SecurityModule } from './common/security/security.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { SessionsModule } from './sessions/sessions.module';
import { MeModule } from './me/me.module';
import Redis from 'ioredis';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: (config) => envSchema.parse(config),
    }),
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', global: true }),
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, Redis],
      useFactory: (config: ConfigService, redis: Redis) => ({
        throttlers: [
          { name: 'default', limit: 100, ttl: 60_000 },
          {
            name: 'register',
            limit: config.get<number>('THROTTLE_REGISTER_LIMIT')!,
            ttl: config.get<number>('THROTTLE_REGISTER_TTL_S')! * 1000,
          },
          {
            name: 'login',
            limit: config.get<number>('THROTTLE_LOGIN_LIMIT')!,
            ttl: config.get<number>('THROTTLE_LOGIN_TTL_S')! * 1000,
          },
          {
            name: 'refresh',
            limit: config.get<number>('THROTTLE_REFRESH_LIMIT')!,
            ttl: config.get<number>('THROTTLE_REFRESH_TTL_S')! * 1000,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    LoggerModule,
    SecurityModule,
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
    SessionsModule,
    MeModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
    {
      provide: APP_FILTER,
      useClass: ProblemDetailsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
