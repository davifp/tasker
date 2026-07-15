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

const TEST_TIMEOUT = 30_000;

describe('GET /api/v1/health (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // @nestjs/config v4 validates env eagerly at forRoot() time.
    // vi.resetModules() ensures a fresh module evaluation with the env vars
    // already present in process.env (set via vitest.config.ts).
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

  it(
    'returns 503 problem+json when Redis is unhealthy',
    async () => {
      vi.resetModules();
      process.env['REDIS_URL'] = 'redis://127.0.0.1:19999';

      const [{ AppModule }, { Test }, { Logger }] = await Promise.all([
        import('../src/app.module'),
        import('@nestjs/testing'),
        import('nestjs-pino'),
      ]);

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const degradedApp = moduleRef.createNestApplication();
      degradedApp.useLogger(degradedApp.get(Logger));
      degradedApp.setGlobalPrefix('api/v1');
      await degradedApp.listen(0);

      const addr = (degradedApp.getHttpServer() as { address(): { port: number } }).address();

      const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/health`);
      await degradedApp.close();

      process.env['REDIS_URL'] = 'redis://localhost:6379';

      expect(res.status).toBe(503);
      expect(res.headers.get('Content-Type')).toContain('application/problem+json');
      const body = (await res.json()) as { traceId?: string; type?: string };
      expect(body).toHaveProperty('traceId');
      expect(body.type).toBe('https://tasker.dev/problems/health-degraded');
    },
    TEST_TIMEOUT,
  );
});
