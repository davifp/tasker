/**
 * OAuth integration tests.
 *
 * Boots real Postgres 16 + Redis 7 containers. Stubs the Google/GitHub HTTP
 * calls by overriding the two provider classes with a fake `fetchProfile`
 * keyed by `code`, so we exercise the full state-issue → state-consume →
 * OAuthAccountLinker → SessionsService pipeline without touching the network.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const TEST_TIMEOUT = 180_000;
const BASE = '/api/v1';

interface CannedProfile {
  provider: 'GOOGLE' | 'GITHUB';
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl?: string;
}

// Fake provider profiles indexed by the `code` the callback receives.
const googleProfiles = new Map<string, CannedProfile>();
const githubProfiles = new Map<string, CannedProfile>();

async function initiate(baseUrl: string, provider: 'google' | 'github'): Promise<string> {
  const res = await fetch(`${baseUrl}${BASE}/auth/oauth/${provider}`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const location = res.headers.get('location');
  expect(location).toBeTruthy();
  const url = new URL(location!);
  const state = url.searchParams.get('state');
  expect(state).toBeTruthy();
  return state!;
}

async function callback(
  baseUrl: string,
  provider: 'google' | 'github',
  { code, state }: { code: string; state: string },
): Promise<Response> {
  return fetch(
    `${baseUrl}${BASE}/auth/oauth/${provider}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' },
  );
}

describe('OAuth callback lifecycle (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_oauth',
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

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_oauth`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'oauth-integration-secret-that-is-32-chars';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['GOOGLE_CLIENT_ID'] = 'test-google-id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'test-google-secret';
    process.env['GITHUB_CLIENT_ID'] = 'test-github-id';
    process.env['GITHUB_CLIENT_SECRET'] = 'test-github-secret';
    process.env['OAUTH_CALLBACK_BASE_URL'] = 'http://localhost:3001';
    process.env['OAUTH_SUCCESS_REDIRECT_URL'] = 'http://localhost:3000/auth/oauth/callback';

    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });

    vi.resetModules();
    const [
      { AppModule },
      { Test },
      { Logger },
      { HibpService },
      { MAIL_PROVIDER },
      { GoogleOAuthProvider },
      { GithubOAuthProvider },
    ] = await Promise.all([
      import('../src/app.module'),
      import('@nestjs/testing'),
      import('nestjs-pino'),
      import('../src/common/security/hibp.service'),
      import('../src/common/mail/mail.provider'),
      import('../src/oauth/providers/google-oauth.provider'),
      import('../src/oauth/providers/github-oauth.provider'),
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HibpService)
      .useValue({ isBreached: vi.fn().mockResolvedValue(false) })
      .overrideProvider(MAIL_PROVIDER)
      .useValue({ send: vi.fn().mockResolvedValue({ jobId: 'mock' }) })
      .overrideProvider(GoogleOAuthProvider)
      .useValue({
        provider: 'GOOGLE',
        buildAuthorizeUrl: ({ state }: { state: string }) =>
          `https://accounts.google.com/fake?state=${state}`,
        fetchProfile: ({ code }: { code: string }) => {
          const profile = googleProfiles.get(code);
          if (!profile) throw new Error(`No fake profile registered for code=${code}`);
          return Promise.resolve(profile);
        },
      })
      .overrideProvider(GithubOAuthProvider)
      .useValue({
        provider: 'GITHUB',
        buildAuthorizeUrl: ({ state }: { state: string }) =>
          `https://github.com/fake?state=${state}`,
        fetchProfile: ({ code }: { code: string }) => {
          const profile = githubProfiles.get(code);
          if (!profile) throw new Error(`No fake profile registered for code=${code}`);
          return Promise.resolve(profile);
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api/v1');
    await app.listen(0);

    const address = (app.getHttpServer() as { address(): { port: number } }).address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
    await pgContainer?.stop();
    await redisContainer?.stop();
  }, TEST_TIMEOUT);

  describe('GET /auth/oauth/:provider (initiate)', () => {
    it('redirects to the provider authorize URL and encodes state', async () => {
      const res = await fetch(`${baseUrl}${BASE}/auth/oauth/google`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      const location = res.headers.get('location')!;
      expect(location).toContain('state=');
    });

    it('returns 404 for an unknown provider', async () => {
      const res = await fetch(`${baseUrl}${BASE}/auth/oauth/twitter`, { redirect: 'manual' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /auth/oauth/:provider/callback', () => {
    it('outcome 4 — new user is created + linked, callback redirects with tokens in fragment', async () => {
      const state = await initiate(baseUrl, 'google');
      const code = 'code-newuser';
      googleProfiles.set(code, {
        provider: 'GOOGLE',
        providerAccountId: 'google-newuser-sub',
        email: 'newuser@example.com',
        emailVerified: true,
        displayName: 'New User',
      });

      const res = await callback(baseUrl, 'google', { code, state });
      expect(res.status).toBe(302);

      const target = new URL(res.headers.get('location')!);
      expect(target.origin + target.pathname).toBe('http://localhost:3000/auth/oauth/callback');
      // Tokens live in the URL fragment
      const fragment = new URLSearchParams(target.hash.slice(1));
      expect(fragment.get('accessToken')).toBeTruthy();
      expect(fragment.get('refreshToken')).toBeTruthy();

      const user = await prisma.user.findUnique({ where: { email: 'newuser@example.com' } });
      expect(user).not.toBeNull();
      expect(user!.emailVerifiedAt).not.toBeNull();
      const link = await prisma.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'GOOGLE',
            providerAccountId: 'google-newuser-sub',
          },
        },
      });
      expect(link).not.toBeNull();
      expect(link!.userId).toBe(user!.id);

      const sessions = await prisma.session.findMany({ where: { userId: user!.id } });
      expect(sessions).toHaveLength(1);
    });

    it('outcome 1 — existing OAuthAccount reuses the same user + issues a second session', async () => {
      const state = await initiate(baseUrl, 'google');
      const code = 'code-returning';
      googleProfiles.set(code, {
        provider: 'GOOGLE',
        providerAccountId: 'google-newuser-sub', // same sub as outcome 4
        email: 'newuser@example.com',
        emailVerified: true,
        displayName: 'New User',
      });

      const res = await callback(baseUrl, 'google', { code, state });
      expect(res.status).toBe(302);

      const user = await prisma.user.findUnique({ where: { email: 'newuser@example.com' } });
      const sessions = await prisma.session.findMany({ where: { userId: user!.id } });
      // Started with 1 session from outcome 4; adds one more
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('outcome 2 — verified local user gets an OAuthAccount linked', async () => {
      // Seed a verified local user
      await prisma.user.create({
        data: {
          email: 'verified-local@example.com',
          emailVerifiedAt: new Date(),
          displayName: 'Verified Local',
        },
      });

      const state = await initiate(baseUrl, 'github');
      const code = 'code-link-verified';
      githubProfiles.set(code, {
        provider: 'GITHUB',
        providerAccountId: 'gh-777',
        email: 'verified-local@example.com',
        emailVerified: true,
        displayName: 'Verified Local',
      });

      const res = await callback(baseUrl, 'github', { code, state });
      expect(res.status).toBe(302);

      const link = await prisma.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: { provider: 'GITHUB', providerAccountId: 'gh-777' },
        },
      });
      expect(link).not.toBeNull();
    });

    it('outcome 3 — unverified local user returns 409 oauth-verify-first, no DB writes', async () => {
      await prisma.user.create({
        data: {
          email: 'unverified-local@example.com',
          emailVerifiedAt: null,
          displayName: 'Unverified',
        },
      });

      const state = await initiate(baseUrl, 'google');
      const code = 'code-unverified-collision';
      googleProfiles.set(code, {
        provider: 'GOOGLE',
        providerAccountId: 'google-collide-sub',
        email: 'unverified-local@example.com',
        emailVerified: true,
        displayName: 'Unverified',
      });

      const res = await callback(baseUrl, 'google', { code, state });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { type?: string };
      expect(body.type).toBe('https://tasker.dev/problems/oauth-verify-first');

      const link = await prisma.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'GOOGLE',
            providerAccountId: 'google-collide-sub',
          },
        },
      });
      expect(link).toBeNull();
    });

    it('returns 400 problem+json when state is missing', async () => {
      const res = await fetch(`${baseUrl}${BASE}/auth/oauth/google/callback?code=code-x`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when state is invalid or expired', async () => {
      const res = await callback(baseUrl, 'google', {
        code: 'code-x',
        state: 'totally-fake-state',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when state was issued for a different provider', async () => {
      const state = await initiate(baseUrl, 'google');
      const res = await callback(baseUrl, 'github', { code: 'code-y', state });
      expect(res.status).toBe(400);
    });
  });
});
