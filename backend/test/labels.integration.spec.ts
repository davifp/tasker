/**
 * Labels module integration tests.
 *
 * Boots real Postgres 16 + Redis 7 and exercises the labels controller
 * end-to-end. Covers:
 * - Role hierarchy (OWNER + ADMIN mutate; MEMBER + GUEST can list but not
 *   mutate)
 * - Name uniqueness scoped to workspace (409 label-name-taken)
 * - Same name allowed across workspaces (tenant scope)
 * - Deleting a label does not delete its attached tasks (cascade only on
 *   the TaskLabel join)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Positions } from '../src/common/ordering/positions';

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

describe('Labels module (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;

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
          POSTGRES_DB: 'tasker_labels',
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

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_labels`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'labels-integration-secret-32-chars!!!';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['APP_BASE_URL'] = 'http://localhost:3000';
    process.env['THROTTLE_REGISTER_LIMIT'] = '100';
    process.env['THROTTLE_LOGIN_LIMIT'] = '100';

    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
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

    workspaceSlug = 'label-space';
    otherWorkspaceSlug = 'label-other';

    owner = await register(baseUrl, 'label-owner@example.com');
    admin = await register(baseUrl, 'label-admin@example.com');
    member = await register(baseUrl, 'label-member@example.com');
    guest = await register(baseUrl, 'label-guest@example.com');
    outsider = await register(baseUrl, 'label-outsider@example.com');
    secondWsOwner = await register(baseUrl, 'label-second-owner@example.com');
    for (const u of [owner, admin, member, guest, outsider, secondWsOwner]) {
      await verifyUser(u.userId);
    }

    const wsRes = await req(baseUrl, 'POST', '/workspaces', {
      token: owner.accessToken,
      body: { name: 'Label Space', slug: workspaceSlug },
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
      body: { name: 'Other', slug: otherWorkspaceSlug },
    });
    expect(otherRes.status).toBe(201);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prismaSingleton?.$disconnect();
    await app?.close();
    await pgContainer?.stop();
    await redisContainer?.stop();
  }, TEST_TIMEOUT);

  describe('POST /labels', () => {
    it('OWNER can create a label with a trimmed name', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/labels`, {
        token: owner.accessToken,
        body: { name: '  bug  ', color: '#ef4444' },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { name: string; color: string; workspaceId: string };
      expect(body.name).toBe('bug');
      expect(body.color).toBe('#ef4444');
      expect(body.workspaceId).toBe(workspaceId);
    });

    it('ADMIN can create a label', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/labels`, {
        token: admin.accessToken,
        body: { name: 'feature', color: '#22c55e' },
      });
      expect(res.status).toBe(201);
    });

    it('MEMBER cannot create a label (403)', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/labels`, {
        token: member.accessToken,
        body: { name: 'chore', color: '#a855f7' },
      });
      expect(res.status).toBe(403);
    });

    it('GUEST cannot create a label (403)', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/labels`, {
        token: guest.accessToken,
        body: { name: 'docs', color: '#3b82f6' },
      });
      expect(res.status).toBe(403);
    });

    it('outsider gets 403 (workspace membership guard)', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/labels`, {
        token: outsider.accessToken,
        body: { name: 'alien', color: '#f97316' },
      });
      expect(res.status).toBe(403);
    });

    it('rejects an invalid color (400)', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/labels`, {
        token: owner.accessToken,
        body: { name: 'bad-color', color: 'blue' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects a duplicate name with 409 label-name-taken', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/labels`, {
        token: owner.accessToken,
        body: { name: 'bug', color: '#ef4444' },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { type: string };
      expect(body.type).toBe('https://tasker.dev/problems/label-name-taken');
    });

    it('allows the same name in a different workspace', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${otherWorkspaceSlug}/labels`, {
        token: secondWsOwner.accessToken,
        body: { name: 'bug', color: '#ef4444' },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { name: string };
      expect(body.name).toBe('bug');
    });
  });

  describe('GET /labels', () => {
    it('MEMBER can list labels', async () => {
      const res = await req(baseUrl, 'GET', `/workspaces/${workspaceSlug}/labels?limit=50`, {
        token: member.accessToken,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ name: string }> };
      expect(body.items.some((l) => l.name === 'bug')).toBe(true);
      expect(body.items.some((l) => l.name === 'feature')).toBe(true);
    });

    it('does not leak labels from another workspace', async () => {
      const res = await req(baseUrl, 'GET', `/workspaces/${workspaceSlug}/labels?limit=100`, {
        token: owner.accessToken,
      });
      const body = (await res.json()) as { items: Array<{ workspaceId: string }> };
      expect(body.items.every((l) => l.workspaceId === workspaceId)).toBe(true);
    });
  });

  describe('PATCH /labels/:id', () => {
    it('ADMIN can rename and recolor a label', async () => {
      const list = await req(baseUrl, 'GET', `/workspaces/${workspaceSlug}/labels?limit=100`, {
        token: admin.accessToken,
      });
      const items = ((await list.json()) as { items: Array<{ id: string; name: string }> }).items;
      const feature = items.find((l) => l.name === 'feature');
      expect(feature).toBeTruthy();

      const res = await req(
        baseUrl,
        'PATCH',
        `/workspaces/${workspaceSlug}/labels/${feature!.id}`,
        {
          token: admin.accessToken,
          body: { name: 'enhancement', color: '#16a34a' },
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; color: string };
      expect(body.name).toBe('enhancement');
      expect(body.color).toBe('#16a34a');
    });

    it('MEMBER cannot rename a label (403)', async () => {
      const list = await req(baseUrl, 'GET', `/workspaces/${workspaceSlug}/labels?limit=100`, {
        token: member.accessToken,
      });
      const items = ((await list.json()) as { items: Array<{ id: string; name: string }> }).items;
      const bug = items.find((l) => l.name === 'bug');
      const res = await req(baseUrl, 'PATCH', `/workspaces/${workspaceSlug}/labels/${bug!.id}`, {
        token: member.accessToken,
        body: { name: 'not-allowed' },
      });
      expect(res.status).toBe(403);
    });

    it('rejects an empty patch body (400)', async () => {
      const list = await req(baseUrl, 'GET', `/workspaces/${workspaceSlug}/labels?limit=100`, {
        token: admin.accessToken,
      });
      const items = ((await list.json()) as { items: Array<{ id: string; name: string }> }).items;
      const bug = items.find((l) => l.name === 'bug');
      const res = await req(baseUrl, 'PATCH', `/workspaces/${workspaceSlug}/labels/${bug!.id}`, {
        token: admin.accessToken,
        body: {},
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /labels/:id', () => {
    it('deleting a label does not delete tasks it was attached to', async () => {
      // Create a project + task + label + attach the label to the task via raw
      // Prisma (Task 4/5 provides the HTTP surface for tasks; here we drive the
      // schema directly to prove the cascade guarantee documented in the
      // techspec).
      const project = await getPrisma().project.create({
        data: {
          workspaceId,
          slug: 'label-delete-project',
          name: 'Label Delete Project',
          color: '#3b82f6',
          icon: 'Package',
          ownerUserId: owner.userId,
          createdByUserId: owner.userId,
        },
      });
      const task = await getPrisma().task.create({
        data: {
          workspaceId,
          projectId: project.id,
          number: 1,
          title: 'Attached',
          position: Positions.between(null, null),
          createdByUserId: owner.userId,
        },
      });
      const label = await getPrisma().label.create({
        data: { workspaceId, name: 'to-delete', color: '#eab308' },
      });
      await getPrisma().taskLabel.create({
        data: { taskId: task.id, labelId: label.id },
      });

      const res = await req(baseUrl, 'DELETE', `/workspaces/${workspaceSlug}/labels/${label.id}`, {
        token: owner.accessToken,
      });
      expect(res.status).toBe(204);

      const remainingTask = await getPrisma().task.findUnique({ where: { id: task.id } });
      expect(remainingTask).not.toBeNull();

      const remainingJoin = await getPrisma().taskLabel.findFirst({
        where: { taskId: task.id, labelId: label.id },
      });
      expect(remainingJoin).toBeNull();
    });

    it('MEMBER cannot delete a label (403)', async () => {
      const list = await req(baseUrl, 'GET', `/workspaces/${workspaceSlug}/labels?limit=100`, {
        token: member.accessToken,
      });
      const items = ((await list.json()) as { items: Array<{ id: string; name: string }> }).items;
      const bug = items.find((l) => l.name === 'bug');
      const res = await req(baseUrl, 'DELETE', `/workspaces/${workspaceSlug}/labels/${bug!.id}`, {
        token: member.accessToken,
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 when the label does not exist in this workspace', async () => {
      const res = await req(
        baseUrl,
        'DELETE',
        `/workspaces/${workspaceSlug}/labels/does-not-exist`,
        { token: owner.accessToken },
      );
      expect(res.status).toBe(404);
    });
  });
});
