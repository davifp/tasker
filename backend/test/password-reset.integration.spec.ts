/**
 * Password reset integration tests.
 *
 * Boots real Postgres 16 + Redis 7 containers. Mocks SMTP to capture tokens.
 * Covers:
 * - POST /auth/password/reset/request always returns 202 (no email enumeration)
 * - POST /auth/password/reset/confirm updates password and revokes all sessions
 * - Expired and consumed tokens return 410
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

describe('Password reset lifecycle (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;
  let redisClient: Redis;

  const capturedMails: Array<{
    template: string;
    to: string;
    variables: Record<string, string | number>;
  }> = [];

  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_pr',
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

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_pr`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'password-reset-integration-secret-long32';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['APP_BASE_URL'] = 'http://localhost:3000';

    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
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

  describe('POST /auth/password/reset/request', () => {
    beforeAll(async () => {
      await redisClient.flushdb();
    });

    it('always returns 202 for a registered email', async () => {
      await post(baseUrl, '/auth/register', {
        email: 'reset-user@example.com',
        password: 'OldPassword1',
        displayName: 'ResetUser',
      });
      await redisClient.flushdb();

      const res = await post(baseUrl, '/auth/password/reset/request', {
        email: 'reset-user@example.com',
      });
      expect(res.status).toBe(202);
    });

    it('returns 202 for an unknown email (no enumeration)', async () => {
      const res = await post(baseUrl, '/auth/password/reset/request', {
        email: 'nobody@example.com',
      });
      expect(res.status).toBe(202);
    });

    it('sends a password-reset email for registered email', async () => {
      const resetMails = capturedMails.filter((m) => m.template === 'password-reset');
      expect(resetMails).toHaveLength(1);
      expect(resetMails[0].to).toBe('reset-user@example.com');
    });
  });

  describe('POST /auth/password/reset/confirm', () => {
    let resetToken: string;

    beforeAll(async () => {
      await redisClient.flushdb();
      capturedMails.length = 0;

      await post(baseUrl, '/auth/register', {
        email: 'confirm-reset@example.com',
        password: 'OldPassword1',
        displayName: 'ConfirmReset',
      });
      await redisClient.flushdb();

      await post(baseUrl, '/auth/password/reset/request', {
        email: 'confirm-reset@example.com',
      });

      const resetMail = capturedMails.find((m) => m.template === 'password-reset')!;
      const resetUrl = resetMail.variables['resetUrl'] as string;
      resetToken = new URL(resetUrl).searchParams.get('token')!;
    });

    it('returns 204 and the old password no longer works after reset', async () => {
      const confirmRes = await post(baseUrl, '/auth/password/reset/confirm', {
        token: resetToken,
        password: 'NewPassword2',
      });
      expect(confirmRes.status).toBe(204);

      // Old password should not work
      const loginOld = await post(baseUrl, '/auth/login', {
        email: 'confirm-reset@example.com',
        password: 'OldPassword1',
      });
      expect(loginOld.status).toBe(401);

      // New password must work
      const loginNew = await post(baseUrl, '/auth/login', {
        email: 'confirm-reset@example.com',
        password: 'NewPassword2',
      });
      expect(loginNew.status).toBe(200);
    });

    it('revokes all sessions — refresh with old token returns 401', async () => {
      // Get a new session with the old password before reset
      await redisClient.flushdb();
      capturedMails.length = 0;

      const regRes = await post(baseUrl, '/auth/register', {
        email: 'revoke-sessions@example.com',
        password: 'OldPassword1',
        displayName: 'RevokeTest',
      });
      const { refreshToken: oldRefresh } = (await regRes.json()) as {
        accessToken: string;
        refreshToken: string;
      };

      await post(baseUrl, '/auth/password/reset/request', { email: 'revoke-sessions@example.com' });
      const resetMail = capturedMails.find(
        (m) => m.to === 'revoke-sessions@example.com' && m.template === 'password-reset',
      )!;
      const token = new URL(resetMail.variables['resetUrl'] as string).searchParams.get('token')!;

      await post(baseUrl, '/auth/password/reset/confirm', { token, password: 'NewPassword2' });

      // Old refresh token must be revoked
      const refreshRes = await post(baseUrl, '/auth/refresh', { refreshToken: oldRefresh });
      expect(refreshRes.status).toBe(401);
    });

    it('returns 410 when the reset token is already consumed', async () => {
      const res = await post(baseUrl, '/auth/password/reset/confirm', {
        token: resetToken,
        password: 'AnotherPassword3',
      });
      expect(res.status).toBe(410);
    });

    it('returns 410 for a non-existent token', async () => {
      const res = await post(baseUrl, '/auth/password/reset/confirm', {
        token: 'totally-invalid-token-that-does-not-exist',
        password: 'NewPassword2',
      });
      expect(res.status).toBe(410);
    });
  });
});
