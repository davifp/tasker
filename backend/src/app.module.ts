import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
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
import { BullMQModule } from './queues/bullmq.module';
import { OAuthModule } from './oauth/oauth.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { InvitationsModule } from './invitations/invitations.module';
import { ContextModule } from './common/context/context.module';
import { WorkspaceGuard } from './common/context/workspace.guard';
import { RolesGuard } from './common/context/roles.guard';
import { WorkspaceContextInterceptor } from './common/context/workspace-context.interceptor';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import Redis from 'ioredis';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: (config) => envSchema.parse(config),
    }),
    // BullMQ global setup — must come before any feature module that calls registerQueue.
    // Uses connection options (not an instance) so BullMQ can spawn its own ioredis connections
    // with maxRetriesPerRequest: null as required by BullMQ.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port || '6379', 10),
            ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      },
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
          // The two throttlers below only apply to routes that opt in via
          // @Throttle({ emailResend: {} }) or @Throttle({ passwordReset: {} }).
          // Without skipIf they would run on every request (Nest applies all
          // named throttlers globally), throttling unrelated endpoints like /health.
          {
            name: 'emailResend',
            limit: config.get<number>('THROTTLE_EMAIL_RESEND_LIMIT', 3)!,
            ttl: config.get<number>('THROTTLE_EMAIL_RESEND_TTL_S', 300)! * 1000,
            skipIf: (ctx) => {
              const req = ctx.switchToHttp().getRequest<{ route?: { path?: string } }>();
              return req.route?.path !== '/auth/email/verify/resend';
            },
          },
          {
            name: 'passwordReset',
            limit: config.get<number>('THROTTLE_PASSWORD_RESET_LIMIT', 3)!,
            ttl: config.get<number>('THROTTLE_PASSWORD_RESET_TTL_S', 300)! * 1000,
            skipIf: (ctx) => {
              const req = ctx.switchToHttp().getRequest<{ route?: { path?: string } }>();
              const path = req.route?.path;
              return (
                path !== '/auth/password/reset/request' && path !== '/auth/password/reset/confirm'
              );
            },
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
    BullMQModule,
    OAuthModule,
    ContextModule,
    WorkspacesModule,
    InvitationsModule,
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
    // WorkspaceGuard runs after JwtAuthGuard so req.user is populated. It skips
    // @Public routes and requests without a workspace signal (header or :slug).
    {
      provide: APP_GUARD,
      useClass: WorkspaceGuard,
    },
    // RolesGuard runs after WorkspaceGuard so req.workspaceContext is populated.
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // WorkspaceContextInterceptor must be registered before IdempotencyInterceptor
    // so ALS-scoped services called from downstream interceptors and handlers see
    // the workspace context loaded by WorkspaceGuard.
    {
      provide: APP_INTERCEPTOR,
      useClass: WorkspaceContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
