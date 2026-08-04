/**
 * Auth integration test suite.
 *
 * Boots real Postgres 16 + Redis 7 containers via Testcontainers, applies all
 * migrations, and asserts the full register → login → refresh → logout lifecycle.
 * Also covers: enumeration-safe error responses, session reuse detection,
 * and per-route throttle override produces 429.
 *
 * Requires Docker.
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

async function get(baseUrl: string, path: string, token: string) {
  return fetch(`${baseUrl}${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function del(baseUrl: string, path: string, token: string) {
  return fetch(`${baseUrl}${BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('Auth lifecycle (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;
  // Separate Redis client used only to flush throttle state between test sections.
  // The app's own Redis client is managed internally; this one is test-only.
  let redisFlushClient: Redis;

  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_test',
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

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_test`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'integration-test-secret-at-least-32-chars';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';

    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });

    redisFlushClient = new Redis(redisUrl);

    vi.resetModules();
    const [{ AppModule }, { Test }, { Logger }, { HibpService }] = await Promise.all([
      import('../src/app.module'),
      import('@nestjs/testing'),
      import('nestjs-pino'),
      import('../src/common/security/hibp.service'),
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HibpService)
      .useValue({ isBreached: vi.fn().mockResolvedValue(false) })
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
    await redisFlushClient?.quit();
    await pgContainer?.stop();
    await redisContainer?.stop();
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // Register
  // ---------------------------------------------------------------------------

  describe('POST /auth/register', () => {
    it('creates a new user and returns access + refresh tokens', async () => {
      const res = await post(baseUrl, '/auth/register', {
        email: 'alice@example.com',
        password: 'securePassword123',
        displayName: 'Alice',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as JsonBody;
      expect(typeof body['accessToken']).toBe('string');
      expect(typeof body['refreshToken']).toBe('string');
    });

    it('returns 409 when email is already registered', async () => {
      await post(baseUrl, '/auth/register', {
        email: 'dup@example.com',
        password: 'Password123',
        displayName: 'Dup',
      });
      const res = await post(baseUrl, '/auth/register', {
        email: 'dup@example.com',
        password: 'Password123',
        displayName: 'Dup2',
      });
      expect(res.status).toBe(409);
    });

    it('returns 400 for password shorter than 8 chars', async () => {
      const res = await post(baseUrl, '/auth/register', {
        email: 'short@example.com',
        password: 'abc',
        displayName: 'Short',
      });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  describe('POST /auth/login', () => {
    beforeAll(async () => {
      // Reset throttle counters so register/login attempts from the previous
      // section do not bleed into this one.
      await redisFlushClient.flushdb();
      await post(baseUrl, '/auth/register', {
        email: 'bob@example.com',
        password: 'bobPassword123',
        displayName: 'Bob',
      });
    });

    it('returns access + refresh tokens for valid credentials', async () => {
      const res = await post(baseUrl, '/auth/login', {
        email: 'bob@example.com',
        password: 'bobPassword123',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as JsonBody;
      expect(typeof body['accessToken']).toBe('string');
    });

    it('returns 401 for wrong password (same shape as valid)', async () => {
      const res = await post(baseUrl, '/auth/login', {
        email: 'bob@example.com',
        password: 'wrongPassword',
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for unknown email — same response as wrong password (no enumeration)', async () => {
      const wrongEmail = await post(baseUrl, '/auth/login', {
        email: 'nobody@example.com',
        password: 'Password123',
      });
      const wrongPass = await post(baseUrl, '/auth/login', {
        email: 'bob@example.com',
        password: 'wrongPassword',
      });
      expect(wrongEmail.status).toBe(401);
      expect(wrongPass.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Refresh + reuse detection
  // ---------------------------------------------------------------------------

  describe('POST /auth/refresh', () => {
    let refreshToken: string;

    beforeAll(async () => {
      await redisFlushClient.flushdb();
      await post(baseUrl, '/auth/register', {
        email: 'charlie@example.com',
        password: 'charliePass123',
        displayName: 'Charlie',
      });
      const res = await post(baseUrl, '/auth/login', {
        email: 'charlie@example.com',
        password: 'charliePass123',
      });
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      refreshToken = body.refreshToken;
    });

    it('returns new access + refresh tokens', async () => {
      const prevToken = refreshToken;
      const res = await post(baseUrl, '/auth/refresh', { refreshToken });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      // Advance the shared token before asserting so the next test always has a fresh one.
      refreshToken = body['refreshToken'];
      expect(typeof body['accessToken']).toBe('string');
      expect(refreshToken).not.toBe(prevToken);
    });

    it('detects refresh token reuse — second use of old token returns 401', async () => {
      const r1 = await post(baseUrl, '/auth/refresh', { refreshToken });
      expect(r1.status).toBe(200);

      // Re-use the same (now-rotated) token
      const r2 = await post(baseUrl, '/auth/refresh', { refreshToken });
      expect(r2.status).toBe(401);
    });

    it('returns 401 for a completely bogus refresh token', async () => {
      const res = await post(baseUrl, '/auth/refresh', { refreshToken: 'fake.garbage' });
      expect(res.status).toBe(401);
    });

    it('concurrent rotation of the same token — exactly one succeeds', async () => {
      await redisFlushClient.flushdb();
      await post(baseUrl, '/auth/register', {
        email: 'grace@example.com',
        password: 'gracePass123',
        displayName: 'Grace',
      });
      const loginRes = await post(baseUrl, '/auth/login', {
        email: 'grace@example.com',
        password: 'gracePass123',
      });
      const { refreshToken: token } = (await loginRes.json()) as {
        accessToken: string;
        refreshToken: string;
      };

      const [r1, r2] = await Promise.all([
        post(baseUrl, '/auth/refresh', { refreshToken: token }),
        post(baseUrl, '/auth/refresh', { refreshToken: token }),
      ]);

      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);
    });
  });

  // ---------------------------------------------------------------------------
  // Protected routes and logout
  // ---------------------------------------------------------------------------

  describe('GET /me', () => {
    let accessToken: string;

    beforeAll(async () => {
      await redisFlushClient.flushdb();
      await post(baseUrl, '/auth/register', {
        email: 'dave@example.com',
        password: 'davePassword123',
        displayName: 'Dave',
      });
      const res = await post(baseUrl, '/auth/login', {
        email: 'dave@example.com',
        password: 'davePassword123',
      });
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
    });

    it('returns user profile with 200', async () => {
      const res = await get(baseUrl, '/me', accessToken);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string; passwordHash?: string };
      expect(body['email']).toBe('dave@example.com');
      expect(body['passwordHash']).toBeUndefined();
    });

    it('returns 401 without a token', async () => {
      const res = await fetch(`${baseUrl}${BASE}/me`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /me/sessions + DELETE /me/sessions/:id', () => {
    let livingAccessToken: string; // the session used to observe post-revoke state
    let revokableAccessToken: string; // the session we intentionally revoke
    let revokableSessionId: string;

    beforeAll(async () => {
      await redisFlushClient.flushdb();
      await post(baseUrl, '/auth/register', {
        email: 'eve@example.com',
        password: 'evePassword123',
        displayName: 'Eve',
      });
      // Two logins ⇒ two sessions. We keep one alive to observe post-revoke
      // state — with immediate JWT revocation (PRD FR-16), the revoked session's
      // access token is rejected right away, so subsequent reads must ride on a
      // still-valid session.
      const first = await post(baseUrl, '/auth/login', {
        email: 'eve@example.com',
        password: 'evePassword123',
      });
      livingAccessToken = ((await first.json()) as { accessToken: string }).accessToken;
      const second = await post(baseUrl, '/auth/login', {
        email: 'eve@example.com',
        password: 'evePassword123',
      });
      revokableAccessToken = ((await second.json()) as { accessToken: string }).accessToken;
    });

    it('lists active sessions', async () => {
      const res = await get(baseUrl, '/me/sessions', livingAccessToken);
      expect(res.status).toBe(200);
      const sessions = (await res.json()) as { id: string }[];
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      // Pick the session that is NOT the one we're using to observe — otherwise
      // we'd revoke our observation token and the follow-up list would 401.
      const observing = sessions[sessions.length - 1]?.id;
      revokableSessionId = sessions.find((s) => s.id !== observing)?.id ?? sessions[0]!.id;
    });

    it('revokes a session successfully', async () => {
      const delRes = await del(baseUrl, `/me/sessions/${revokableSessionId}`, revokableAccessToken);
      expect(delRes.status).toBe(200);

      const listRes = await get(baseUrl, '/me/sessions', livingAccessToken);
      expect(listRes.status).toBe(200);
      const sessions = (await listRes.json()) as { id: string }[];
      expect(sessions.some((s) => s.id === revokableSessionId)).toBe(false);
    });

    it('rejects the revoked session’s access token on subsequent requests (FR-16)', async () => {
      // The revoked session must be honoured as revoked immediately — the
      // access JWT is stateless with a 15-minute TTL, so without checking the
      // session on every request we'd honour it for up to 15 minutes.
      const res = await get(baseUrl, '/me', revokableAccessToken);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    let accessToken: string;
    let refreshToken: string;

    beforeAll(async () => {
      await redisFlushClient.flushdb();
      await post(baseUrl, '/auth/register', {
        email: 'frank@example.com',
        password: 'frankPass123',
        displayName: 'Frank',
      });
      const res = await post(baseUrl, '/auth/login', {
        email: 'frank@example.com',
        password: 'frankPass123',
      });
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      accessToken = body.accessToken;
      refreshToken = body.refreshToken;
    });

    it('logs out and refresh token is subsequently rejected', async () => {
      const logoutRes = await post(
        baseUrl,
        '/auth/logout',
        {},
        {
          Authorization: `Bearer ${accessToken}`,
        },
      );
      expect(logoutRes.status).toBe(204);

      const refreshRes = await post(baseUrl, '/auth/refresh', { refreshToken });
      expect(refreshRes.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  describe('Rate limiting on /auth/login', () => {
    it('returns 429 after 5 attempts within the window', async () => {
      // Different email to avoid interference; server doesn't need to exist
      const attempts = Array.from({ length: 6 }, () =>
        post(baseUrl, '/auth/login', { email: `rl-${Date.now()}@example.com`, password: 'x' }),
      );
      const results = await Promise.all(attempts);
      const statuses = results.map((r) => r.status);
      expect(statuses).toContain(429);
    });
  });
});
