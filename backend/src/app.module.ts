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
import { StorageModule } from './common/storage/storage.module';
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
import { ProjectsModule } from './projects/projects.module';
import { LabelsModule } from './labels/labels.module';
import { TasksModule } from './tasks/tasks.module';
import { AttachmentsModule } from './tasks/attachments/attachments.module';
import { UserProjectViewPreferencesModule } from './user-project-view-preferences/user-project-view-preferences.module';
import { SprintsModule } from './sprints/sprints.module';
import { EpicsModule } from './epics/epics.module';
import { MetricsModule } from './metrics/metrics.module';
import { SearchModule } from './search/search.module';
import { AuditReadModule } from './audit/audit-read.module';
import { ContextModule } from './common/context/context.module';
import { AuditModule } from './common/audit/audit.module';
import { ActivityModule } from './common/activity/activity.module';
import { WorkspaceGuard } from './common/context/workspace.guard';
import { RolesGuard } from './common/context/roles.guard';
import { WorkspaceContextInterceptor } from './common/context/workspace-context.interceptor';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import type { ExecutionContext } from '@nestjs/common';
import Redis from 'ioredis';

// Throttlers below use route-scoped skipIf. `req.route?.path` is unreliable
// because it depends on whether the guard runs before or after express-router
// sets that field. `originalUrl` is set by the outer server the moment the
// request enters, so it's always available. It includes the global prefix
// (`/api/v1`), plus any query string — strip both before comparing.
function matchesPath(ctx: ExecutionContext, target: string): boolean {
  const req = ctx.switchToHttp().getRequest<{ originalUrl?: string; url: string }>();
  const raw = req.originalUrl ?? req.url ?? '';
  const path = raw.split('?', 1)[0]!.replace(/^\/api\/v1/, '');
  return path === target;
}

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
          {
            name: 'default',
            limit: config.get<number>('THROTTLE_DEFAULT_LIMIT')!,
            ttl: config.get<number>('THROTTLE_DEFAULT_TTL_S')! * 1000,
          },
          // Named throttlers below MUST include a skipIf that matches the
          // exact route they cover — @nestjs/throttler runs every registered
          // throttler on every request unless one opts out. Without skipIf,
          // `login: 5/min` silently applies to `/me`, `/workspaces/*`, and
          // any polling UI would burn through the budget in seconds.
          {
            name: 'register',
            limit: config.get<number>('THROTTLE_REGISTER_LIMIT')!,
            ttl: config.get<number>('THROTTLE_REGISTER_TTL_S')! * 1000,
            skipIf: (ctx) => !matchesPath(ctx, '/auth/register'),
          },
          {
            name: 'login',
            limit: config.get<number>('THROTTLE_LOGIN_LIMIT')!,
            ttl: config.get<number>('THROTTLE_LOGIN_TTL_S')! * 1000,
            skipIf: (ctx) => !matchesPath(ctx, '/auth/login'),
          },
          {
            name: 'refresh',
            limit: config.get<number>('THROTTLE_REFRESH_LIMIT')!,
            ttl: config.get<number>('THROTTLE_REFRESH_TTL_S')! * 1000,
            skipIf: (ctx) => !matchesPath(ctx, '/auth/refresh'),
          },
          {
            name: 'emailResend',
            limit: config.get<number>('THROTTLE_EMAIL_RESEND_LIMIT', 3)!,
            ttl: config.get<number>('THROTTLE_EMAIL_RESEND_TTL_S', 300)! * 1000,
            skipIf: (ctx) => !matchesPath(ctx, '/auth/email/verify/resend'),
          },
          {
            name: 'passwordReset',
            limit: config.get<number>('THROTTLE_PASSWORD_RESET_LIMIT', 3)!,
            ttl: config.get<number>('THROTTLE_PASSWORD_RESET_TTL_S', 300)! * 1000,
            skipIf: (ctx) =>
              !matchesPath(ctx, '/auth/password/reset/request') &&
              !matchesPath(ctx, '/auth/password/reset/confirm'),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    LoggerModule,
    SecurityModule,
    StorageModule,
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
    SessionsModule,
    MeModule,
    BullMQModule,
    OAuthModule,
    ContextModule,
    AuditModule,
    ActivityModule,
    WorkspacesModule,
    InvitationsModule,
    ProjectsModule,
    LabelsModule,
    TasksModule,
    AttachmentsModule,
    UserProjectViewPreferencesModule,
    SprintsModule,
    EpicsModule,
    MetricsModule,
    SearchModule,
    AuditReadModule,
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
