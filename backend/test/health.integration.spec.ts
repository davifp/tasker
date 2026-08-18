/**
 * Integration tests for GET /api/v1/health.
 *
 * Requires the Docker Compose dev services to be running:
 *   docker compose -f infra/docker-compose.yml up -d
 *
 * env vars are preset by vitest.config.ts so AppModule can be imported
 * statically without triggering @nestjs/config's eager validation error.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Logger as PinoLogger, LoggerModule } from 'nestjs-pino';
import Redis from 'ioredis';
import { HealthController } from '../src/health/health.controller';
import { PrismaHealthIndicator } from '../src/health/prisma.health';
import { RedisHealthIndicator } from '../src/health/redis.health';
import { BullMqHealthIndicator } from '../src/health/bullmq.health';
import { StorageHealthIndicator } from '../src/health/storage.health';
import { LlmHealthIndicator } from '../src/health/llm.health';
import { HealthMetrics } from '../src/health/health.metrics';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { MAIL_QUEUE, CLEANUP_QUEUE } from '../src/queues/constants';
import { StorageService } from '../src/common/storage/storage.service';
import { LlmRouter } from '../src/ai/providers/llm-router';
import { MetricsRegistryService } from '../src/metrics/metrics-registry.service';

const TEST_TIMEOUT = 30_000;

describe('GET /api/v1/health (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();

    const [{ AppModule }, { Test }, { Logger }] = await Promise.all([
      import('../src/app.module'),
      import('@nestjs/testing'),
      import('nestjs-pino'),
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api/v1');
    await app.listen(0);

    const address = (app.getHttpServer() as { address(): { port: number } }).address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await app?.close();
  }, TEST_TIMEOUT);

  it('returns 200 with status:ok when Postgres and Redis are healthy', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('echoes x-trace-id from the inbound header', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { 'x-trace-id': 'integration-test-trace' },
    });
    expect(res.headers.get('x-trace-id')).toBe('integration-test-trace');
  });

  // The degraded path is exercised against a minimal module that wires only
  // the health slice + injected fakes. Booting the full AppModule with
  // `REDIS_URL` pointed at a dead port drags BullMQ and other Redis-consuming
  // modules into infinite `maxRetriesPerRequest: null` connect loops that
  // outlive `app.close()` and, on a slow scheduler, land as vitest-fatal
  // unhandled rejections. Isolating the slice removes the failure surface
  // that has nothing to do with what is being asserted.
  it(
    'returns 503 problem+json when Redis is unhealthy',
    async () => {
      const failingRedis = {
        ping: async (): Promise<string> => {
          throw new Error('ECONNREFUSED (mocked)');
        },
      } as unknown as Redis;
      const healthyQueueMock = {
        getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0 }),
        isPaused: async () => false,
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
          LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
          TerminusModule,
        ],
        controllers: [HealthController],
        providers: [
          PrismaHealthIndicator,
          RedisHealthIndicator,
          BullMqHealthIndicator,
          StorageHealthIndicator,
          LlmHealthIndicator,
          HealthMetrics,
          { provide: PrismaService, useValue: { ping: async () => undefined } },
          { provide: Redis, useValue: failingRedis },
          { provide: getQueueToken(MAIL_QUEUE), useValue: healthyQueueMock },
          { provide: getQueueToken(CLEANUP_QUEUE), useValue: healthyQueueMock },
          { provide: StorageService, useValue: { headBucket: async () => undefined } },
          { provide: LlmRouter, useValue: { probeDefault: async () => ({ ok: true }) } },
          {
            provide: MetricsRegistryService,
            useValue: {
              gauge: () => ({ set: () => undefined, labels: () => ({ set: () => undefined }) }),
              counter: () => ({ inc: () => undefined, labels: () => ({ inc: () => undefined }) }),
              histogram: () => ({
                observe: () => undefined,
                labels: () => ({ observe: () => undefined }),
              }),
            },
          },
          { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        ],
      })
        .overrideProvider(ConfigService)
        .useValue({ get: () => undefined, getOrThrow: () => 'noop' })
        .compile();

      const degradedApp = moduleRef.createNestApplication();
      degradedApp.useLogger(degradedApp.get(PinoLogger));
      degradedApp.setGlobalPrefix('api/v1');
      await degradedApp.listen(0);

      try {
        const addr = (degradedApp.getHttpServer() as { address(): { port: number } }).address();
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/health`);

        expect(res.status).toBe(503);
        expect(res.headers.get('Content-Type')).toContain('application/problem+json');
        const body = (await res.json()) as { traceId?: string; type?: string };
        expect(body).toHaveProperty('traceId');
        expect(body.type).toBe('https://tasker.dev/problems/health-degraded');
      } finally {
        await degradedApp.close();
      }
    },
    TEST_TIMEOUT,
  );
});
