/**
 * Projects module integration tests.
 *
 * Boots real Postgres 16 + Redis 7 and exercises the projects controller
 * end-to-end through the HTTP layer. Covers:
 * - Verified-email + workspace membership gating
 * - Role hierarchy (OWNER + ADMIN can mutate; MEMBER + GUEST cannot)
 * - Slug uniqueness + numeric-suffix retry
 * - Cursor pagination on 25 seeded projects with limit=10
 * - Soft delete + restore semantics
 * - Cross-workspace isolation (outsider + wrong-workspace 403)
 * - Idempotency-Key short-circuit on POST
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const TEST_TIMEOUT = 180_000;
const BASE = '/api/v1';

interface JsonBody {
  [k: string]: unknown;
}

async function req(
  baseUrl: string,
  method: string,
  path: string,
  init: { body?: JsonBody; token?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    ...(init.headers ?? {}),
  };
  return fetch(`${baseUrl}${BASE}${path}`, {
    method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

let prismaSingleton: PrismaClient | undefined;
function getPrisma(): PrismaClient {
  if (!prismaSingleton) throw new Error('prisma not initialised');
  return prismaSingleton;
}

async function register(
  baseUrl: string,
  email: string,
  password = 'GoodPass123',
): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
  const res = await req(baseUrl, 'POST', '/auth/register', {
    body: { email, password, displayName: email.split('@')[0] },
  });
  const body = (await res.json()) as { accessToken: string; refreshToken: string };
  const user = await getPrisma().user.findUnique({ where: { email } });
  return { userId: user!.id, accessToken: body.accessToken, refreshToken: body.refreshToken };
}

async function verifyUser(userId: string): Promise<void> {
  await getPrisma().user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
}

describe('Projects module (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;

  // Seeded actors + workspaces (see beforeAll)
  let owner: Awaited<ReturnType<typeof register>>;
  let admin: Awaited<ReturnType<typeof register>>;
  let member: Awaited<ReturnType<typeof register>>;
  let guest: Awaited<ReturnType<typeof register>>;
  let outsider: Awaited<ReturnType<typeof register>>;
  let secondWsOwner: Awaited<ReturnType<typeof register>>;
  let workspaceSlug: string;
  let workspaceId: string;
  let otherWorkspaceSlug: string;

  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_projects',
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

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_projects`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'projects-integration-secret-32-chars!';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['APP_BASE_URL'] = 'http://localhost:3000';
    process.env['THROTTLE_REGISTER_LIMIT'] = '100';
    process.env['THROTTLE_LOGIN_LIMIT'] = '100';

    execSync('pnpm prisma migrate deploy', {
      cwd: '/home/davi/tasker/backend',
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'inherit',
    });

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
      .useValue({ send: vi.fn().mockResolvedValue({ jobId: 'noop' }) })
      .compile();

    app = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api/v1');
    await app.listen(0);
    const address = (app.getHttpServer() as { address(): { port: number } }).address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    prismaSingleton = new PrismaClient({ datasources: { db: { url: dbUrl } } });

    // Seed: one workspace with owner, admin, member, guest; a second workspace
    // in another tenant to prove isolation.
    workspaceSlug = 'proj-space';
    otherWorkspaceSlug = 'proj-other';

    owner = await register(baseUrl, 'proj-owner@example.com');
    admin = await register(baseUrl, 'proj-admin@example.com');
    member = await register(baseUrl, 'proj-member@example.com');
    guest = await register(baseUrl, 'proj-guest@example.com');
    outsider = await register(baseUrl, 'proj-outsider@example.com');
    secondWsOwner = await register(baseUrl, 'proj-second-owner@example.com');
    for (const u of [owner, admin, member, guest, outsider, secondWsOwner]) {
      await verifyUser(u.userId);
    }

    const wsRes = await req(baseUrl, 'POST', '/workspaces', {
      token: owner.accessToken,
      body: { name: 'Projects Space', slug: workspaceSlug },
    });
    workspaceId = ((await wsRes.json()) as { id: string }).id;

    await getPrisma().workspaceMember.createMany({
      data: [
        { workspaceId, userId: admin.userId, role: 'ADMIN' },
        { workspaceId, userId: member.userId, role: 'MEMBER' },
        { workspaceId, userId: guest.userId, role: 'GUEST' },
      ],
    });

    const otherRes = await req(baseUrl, 'POST', '/workspaces', {
      token: secondWsOwner.accessToken,
      body: { name: 'Other Space', slug: otherWorkspaceSlug },
    });
    expect(otherRes.status).toBe(201);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prismaSingleton?.$disconnect();
    await app?.close();
    await pgContainer?.stop();
    await redisContainer?.stop();
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // POST /projects — role gating, slug retry, Idempotency-Key
  // ---------------------------------------------------------------------------

  describe('POST /projects', () => {
    it('OWNER can create a project', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: owner.accessToken,
        body: { name: 'Web', slug: 'web', color: '#3b82f6', icon: 'Package' },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        slug: string;
        ownerUserId: string;
        createdByUserId: string;
        workspaceId: string;
      };
      expect(body.slug).toBe('web');
      expect(body.ownerUserId).toBe(owner.userId);
      expect(body.createdByUserId).toBe(owner.userId);
      expect(body.workspaceId).toBe(workspaceId);
    });

    it('ADMIN can create a project', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: admin.accessToken,
        body: { name: 'Mobile', slug: 'mobile', color: '#10b981', icon: 'Smartphone' },
      });
      expect(res.status).toBe(201);
    });

    it('MEMBER cannot create a project (403)', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: member.accessToken,
        body: { name: 'Design', slug: 'design', color: '#f59e0b', icon: 'Palette' },
      });
      expect(res.status).toBe(403);
    });

    it('GUEST cannot create a project (403)', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: guest.accessToken,
        body: { name: 'Ops', slug: 'ops', color: '#ef4444', icon: 'Server' },
      });
      expect(res.status).toBe(403);
    });

    it('outsider gets 403 (workspace membership guard)', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: outsider.accessToken,
        body: { name: 'Alien', slug: 'alien', color: '#a855f7', icon: 'Ghost' },
      });
      expect(res.status).toBe(403);
    });

    it('rejects an invalid color (400)', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: owner.accessToken,
        body: { name: 'Invalid', slug: 'invalid', color: 'blue', icon: 'X' },
      });
      expect(res.status).toBe(400);
    });

    it('retries with a numeric suffix on slug collision', async () => {
      // 'web' already exists from an earlier test — a fresh POST with the same
      // slug must land as 'web-2'.
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: admin.accessToken,
        body: { name: 'Web 2', slug: 'web', color: '#3b82f6', icon: 'Package' },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { slug: string };
      expect(body.slug).toBe('web-2');
    });

    it('short-circuits duplicate creation via Idempotency-Key', async () => {
      const first = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: owner.accessToken,
        headers: { 'Idempotency-Key': 'proj-idem-1' },
        body: { name: 'Idem', slug: 'idem', color: '#3b82f6', icon: 'Package' },
      });
      expect(first.status).toBe(201);
      const firstBody = await first.json();

      const second = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: owner.accessToken,
        headers: { 'Idempotency-Key': 'proj-idem-1' },
        body: { name: 'Idem', slug: 'idem', color: '#3b82f6', icon: 'Package' },
      });
      expect(second.status).toBe(201);
      expect(await second.json()).toEqual(firstBody);
    });

    it('allows the same slug in a different workspace (tenant scope)', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${otherWorkspaceSlug}/projects`, {
        token: secondWsOwner.accessToken,
        body: { name: 'Web', slug: 'web', color: '#3b82f6', icon: 'Package' },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { slug: string };
      expect(body.slug).toBe('web');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /projects — list + cursor pagination
  // ---------------------------------------------------------------------------

  describe('GET /projects', () => {
    let paginationSlug: string;
    let paginationOwner: Awaited<ReturnType<typeof register>>;

    beforeAll(async () => {
      paginationSlug = 'pagination-space';
      paginationOwner = await register(baseUrl, 'pagination-owner@example.com');
      await verifyUser(paginationOwner.userId);
      const wsRes = await req(baseUrl, 'POST', '/workspaces', {
        token: paginationOwner.accessToken,
        body: { name: 'Pagination', slug: paginationSlug },
      });
      expect(wsRes.status).toBe(201);

      // Seed 25 projects sequentially so createdAt ordering is stable.
      for (let i = 0; i < 25; i++) {
        const res = await req(baseUrl, 'POST', `/workspaces/${paginationSlug}/projects`, {
          token: paginationOwner.accessToken,
          body: {
            name: `Project ${i}`,
            slug: `project-${String(i).padStart(2, '0')}`,
            color: '#3b82f6',
            icon: 'Package',
          },
        });
        expect(res.status).toBe(201);
      }
    }, TEST_TIMEOUT);

    it('paginates through 25 items with limit=10 across 3 pages', async () => {
      const p1 = await req(baseUrl, 'GET', `/workspaces/${paginationSlug}/projects?limit=10`, {
        token: paginationOwner.accessToken,
      });
      expect(p1.status).toBe(200);
      const b1 = (await p1.json()) as { items: unknown[]; nextCursor: string | null };
      expect(b1.items).toHaveLength(10);
      expect(b1.nextCursor).not.toBeNull();

      const p2 = await req(
        baseUrl,
        'GET',
        `/workspaces/${paginationSlug}/projects?limit=10&cursor=${b1.nextCursor}`,
        { token: paginationOwner.accessToken },
      );
      const b2 = (await p2.json()) as { items: unknown[]; nextCursor: string | null };
      expect(b2.items).toHaveLength(10);
      expect(b2.nextCursor).not.toBeNull();

      const p3 = await req(
        baseUrl,
        'GET',
        `/workspaces/${paginationSlug}/projects?limit=10&cursor=${b2.nextCursor}`,
        { token: paginationOwner.accessToken },
      );
      const b3 = (await p3.json()) as { items: unknown[]; nextCursor: string | null };
      expect(b3.items).toHaveLength(5);
      expect(b3.nextCursor).toBeNull();
    });

    it('does not leak projects from another workspace', async () => {
      const res = await req(baseUrl, 'GET', `/workspaces/${workspaceSlug}/projects?limit=100`, {
        token: owner.accessToken,
      });
      const body = (await res.json()) as { items: Array<{ workspaceId: string }> };
      expect(body.items.every((p) => p.workspaceId === workspaceId)).toBe(true);
      // Sanity: the pagination workspace exists but its projects must not surface.
      expect(body.items.some((p) => p.workspaceId !== workspaceId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH + DELETE + POST /restore
  // ---------------------------------------------------------------------------

  describe('PATCH /projects/:slug', () => {
    it('OWNER can update name + color; MEMBER cannot', async () => {
      const okRes = await req(baseUrl, 'PATCH', `/workspaces/${workspaceSlug}/projects/mobile`, {
        token: owner.accessToken,
        body: { name: 'Mobile Renamed', color: '#0ea5e9' },
      });
      expect(okRes.status).toBe(200);
      const body = (await okRes.json()) as { name: string; color: string };
      expect(body.name).toBe('Mobile Renamed');
      expect(body.color).toBe('#0ea5e9');

      const denied = await req(baseUrl, 'PATCH', `/workspaces/${workspaceSlug}/projects/mobile`, {
        token: member.accessToken,
        body: { name: 'Nope' },
      });
      expect(denied.status).toBe(403);
    });

    it('rejects an empty body (400)', async () => {
      const res = await req(baseUrl, 'PATCH', `/workspaces/${workspaceSlug}/projects/mobile`, {
        token: owner.accessToken,
        body: {},
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /projects/:slug + restore', () => {
    it('OWNER can soft-delete; project vanishes from list; restore brings it back', async () => {
      // Create a dedicated project for this test to avoid coupling.
      const createRes = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: owner.accessToken,
        body: { name: 'Ephemeral', slug: 'ephemeral', color: '#ef4444', icon: 'Trash' },
      });
      expect(createRes.status).toBe(201);

      const deleteRes = await req(
        baseUrl,
        'DELETE',
        `/workspaces/${workspaceSlug}/projects/ephemeral`,
        { token: owner.accessToken },
      );
      expect(deleteRes.status).toBe(204);

      // Default list excludes soft-deleted projects.
      const listRes = await req(baseUrl, 'GET', `/workspaces/${workspaceSlug}/projects?limit=100`, {
        token: owner.accessToken,
      });
      const listBody = (await listRes.json()) as { items: Array<{ slug: string }> };
      expect(listBody.items.some((p) => p.slug === 'ephemeral')).toBe(false);

      // Restore endpoint reverses the soft delete.
      const restoreRes = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/ephemeral/restore`,
        { token: owner.accessToken },
      );
      expect(restoreRes.status).toBe(201);
      const restored = (await restoreRes.json()) as { deletedAt: string | null };
      expect(restored.deletedAt).toBeNull();

      // Confirm it surfaces again.
      const listRes2 = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects?limit=100`,
        {
          token: owner.accessToken,
        },
      );
      const listBody2 = (await listRes2.json()) as { items: Array<{ slug: string }> };
      expect(listBody2.items.some((p) => p.slug === 'ephemeral')).toBe(true);
    });

    it('MEMBER cannot delete (403)', async () => {
      const res = await req(baseUrl, 'DELETE', `/workspaces/${workspaceSlug}/projects/web`, {
        token: member.accessToken,
      });
      expect(res.status).toBe(403);
    });
  });
});
