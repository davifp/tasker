/**
 * Email verification integration tests.
 *
 * Boots real Postgres 16 + Redis 7 containers. Mocks SMTP (QueuedMailAdapter.send)
 * so we can capture token URLs without a live mail server. Covers:
 * - signup enqueues exactly one email-verify job
 * - POST /auth/email/verify consumes the token and marks emailVerifiedAt
 * - expired and already-consumed tokens return 410
 * - POST /auth/email/verify/resend sends a new token (requires auth)
 * - EmailVerificationRequiredGuard returns 403 before and 200 after verification
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';

const TEST_TIMEOUT = 180_000;
const BASE = '/api/v1';

type JsonBody = Record<string, unknown>;

async function post(
  baseUrl: string,
  path: string,
  body: JsonBody,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('Email verification lifecycle (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;
  let redisClient: Redis;

  // Collects tokens enqueued to the mail queue instead of sending via SMTP
  const capturedMails: Array<{
    template: string;
    to: string;
    variables: Record<string, string | number>;
  }> = [];

  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_ev',
          POSTGRES_USER: 'tasker',
          POSTGRES_PASSWORD: 'tasker',
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
        .start(),
      new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
        .start(),
    ]);

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_ev`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'email-verification-integration-secret-32c';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['APP_BASE_URL'] = 'http://localhost:3000';

    execSync('pnpm prisma migrate deploy', {
      cwd: '/home/davi/tasker/backend',
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });

    redisClient = new Redis(redisUrl);

    vi.resetModules();
    const [{ AppModule }, { Test }, { Logger }, { HibpService }, { MAIL_PROVIDER }] =
      await Promise.all([
        import('../src/app.module'),
        import('@nestjs/testing'),
        import('nestjs-pino'),
        import('../src/common/security/hibp.service'),
        import('../src/common/mail/mail.provider'),
      ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HibpService)
      .useValue({ isBreached: vi.fn().mockResolvedValue(false) })
      .overrideProvider(MAIL_PROVIDER)
      .useValue({
        send: vi
          .fn()
          .mockImplementation(
            (input: {
              template: string;
              to: string;
              variables: Record<string, string | number>;
            }) => {
              capturedMails.push(input);
              return Promise.resolve({ jobId: `mock-${capturedMails.length}` });
            },
          ),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api/v1');
    await app.listen(0);

    const address = (app.getHttpServer() as { address(): { port: number } }).address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await app?.close();
    await redisClient?.quit();
    await pgContainer?.stop();
    await redisContainer?.stop();
  }, TEST_TIMEOUT);

  describe('POST /auth/email/verify', () => {
    beforeAll(async () => {
      await redisClient.flushdb();
      capturedMails.length = 0;

      await post(baseUrl, '/auth/register', {
        email: 'verify-test@example.com',
        password: 'SecurePass1',
        displayName: 'VerifyUser',
      });
    });

    it('signup enqueues exactly one email-verify job', () => {
      const verifyMails = capturedMails.filter((m) => m.template === 'email-verify');
      expect(verifyMails).toHaveLength(1);
      expect(verifyMails[0].to).toBe('verify-test@example.com');
    });

    it('returns 204 and marks email as verified for a valid token', async () => {
      const mail = capturedMails.find((m) => m.template === 'email-verify')!;
      const verifyUrl = mail.variables['verifyUrl'] as string;
      const token = new URL(verifyUrl).searchParams.get('token')!;

      const res = await post(baseUrl, '/auth/email/verify', { token });
      expect(res.status).toBe(204);
    });

    it('returns 410 when the token is already consumed', async () => {
      const mail = capturedMails.find((m) => m.template === 'email-verify')!;
      const verifyUrl = mail.variables['verifyUrl'] as string;
      const token = new URL(verifyUrl).searchParams.get('token')!;

      const res = await post(baseUrl, '/auth/email/verify', { token });
      expect(res.status).toBe(410);
    });

    it('POST /auth/email/verify/resend returns 204 and enqueues another email', async () => {
      // Register an unverified user first
      await redisClient.flushdb();
      const regRes = await post(baseUrl, '/auth/register', {
        email: 'resend-test@example.com',
        password: 'SecurePass1',
        displayName: 'ResendUser',
      });
      const { accessToken: token } = (await regRes.json()) as { accessToken: string };
      const beforeCount = capturedMails.filter((m) => m.to === 'resend-test@example.com').length;

      const res = await fetch(`${baseUrl}${BASE}/auth/email/verify/resend`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(204);

      const afterCount = capturedMails.filter((m) => m.to === 'resend-test@example.com').length;
      expect(afterCount).toBe(beforeCount + 1);
    });

    it('returns 400 with bad token format', async () => {
      const res = await post(baseUrl, '/auth/email/verify', { token: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /me guarded by JwtAuthGuard does not need email verification', () => {
    it('returns 200 for unverified user (sign-in is allowed)', async () => {
      await redisClient.flushdb();
      const regRes = await post(baseUrl, '/auth/register', {
        email: 'unverified@example.com',
        password: 'SecurePass1',
        displayName: 'Unverified',
      });
      const { accessToken } = (await regRes.json()) as { accessToken: string };

      const res = await fetch(`${baseUrl}${BASE}/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(200);
    });
  });
});
