/**
 * Task 5.0 integration coverage for the drawer-facing sub-resources:
 * - Task dependencies (add/remove, cycle detection, blocker gate on move)
 * - Task checklists (CRUD, reorder via Positions)
 * - Task comments (CRUD with author-vs-role RBAC)
 *
 * Boots real Postgres 16 + Redis 7 and exercises the HTTP surface end to
 * end, mirroring the concurrency and RBAC invariants of the parent tasks
 * module tests. See techspec §API endpoints (Task sub-resources) and
 * §Testing approach for the invariants under test here.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Positions } from '../src/common/ordering/positions';

const TEST_TIMEOUT = 240_000;
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

describe('Task sub-resources (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;

  let owner: Awaited<ReturnType<typeof register>>;
  let admin: Awaited<ReturnType<typeof register>>;
  let member: Awaited<ReturnType<typeof register>>;
  let member2: Awaited<ReturnType<typeof register>>;
  let outsider: Awaited<ReturnType<typeof register>>;
  const workspaceSlug = 'sub-res';
  const projectSlug = 'web';
  let workspaceId: string;

  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_subres',
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

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_subres`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'subres-integration-secret-32-chars!!!';
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

    owner = await register(baseUrl, 'subres-owner@example.com');
    admin = await register(baseUrl, 'subres-admin@example.com');
    member = await register(baseUrl, 'subres-member@example.com');
    member2 = await register(baseUrl, 'subres-member2@example.com');
    outsider = await register(baseUrl, 'subres-outsider@example.com');
    for (const u of [owner, admin, member, member2, outsider]) {
      await verifyUser(u.userId);
    }

    const wsRes = await req(baseUrl, 'POST', '/workspaces', {
      token: owner.accessToken,
      body: { name: 'Sub Res', slug: workspaceSlug },
    });
    workspaceId = ((await wsRes.json()) as { id: string }).id;

    await getPrisma().workspaceMember.createMany({
      data: [
        { workspaceId, userId: admin.userId, role: 'ADMIN' },
        { workspaceId, userId: member.userId, role: 'MEMBER' },
        { workspaceId, userId: member2.userId, role: 'MEMBER' },
      ],
    });

    const projRes = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
      token: owner.accessToken,
      body: { name: 'Web', slug: projectSlug, color: '#3b82f6', icon: 'Package' },
    });
    expect(projRes.status).toBe(201);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prismaSingleton?.$disconnect();
    await app?.close();
    await pgContainer?.stop();
    await redisContainer?.stop();
  }, TEST_TIMEOUT);

  // Small helper: create a task via HTTP and return the parsed body.
  async function createTask(
    title: string,
    token: string = member.accessToken,
  ): Promise<{ id: string; number: number; updatedAt: string; status: string }> {
    const res = await req(
      baseUrl,
      'POST',
      `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`,
      {
        token,
        body: { title },
      },
    );
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; number: number; updatedAt: string; status: string };
  }

  // ---------------------------------------------------------------------------
  // Dependencies
  // ---------------------------------------------------------------------------

  describe('POST/DELETE /tasks/:number/dependencies', () => {
    it('add + list + remove happy path', async () => {
      const a = await createTask('dep-A');
      const b = await createTask('dep-B');

      const add = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${a.number}/dependencies`,
        { token: member.accessToken, body: { blockedByTaskId: b.id } },
      );
      expect(add.status).toBe(201);

      const list = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${a.number}/dependencies`,
        { token: member.accessToken },
      );
      const items = (await list.json()) as Array<{ blockedByTaskId: string }>;
      expect(items).toHaveLength(1);
      expect(items[0]?.blockedByTaskId).toBe(b.id);

      const remove = await req(
        baseUrl,
        'DELETE',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${a.number}/dependencies/${b.id}`,
        { token: member.accessToken },
      );
      expect(remove.status).toBe(204);
    });

    it('rejects a self-loop with dependency-cycle', async () => {
      const a = await createTask('self-A');
      const res = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${a.number}/dependencies`,
        { token: member.accessToken, body: { blockedByTaskId: a.id } },
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { type: string };
      expect(body.type).toBe('https://tasker.dev/problems/dependency-cycle');
    });

    it('rejects a back-edge that would close a 2-cycle (B blocks A → A blocks B fails)', async () => {
      const a = await createTask('bc-A');
      const b = await createTask('bc-B');
      // B is blocked by A first — perfectly fine.
      const first = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${b.number}/dependencies`,
        { token: member.accessToken, body: { blockedByTaskId: a.id } },
      );
      expect(first.status).toBe(201);
      // Now trying to say A is blocked by B closes the cycle.
      const second = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${a.number}/dependencies`,
        { token: member.accessToken, body: { blockedByTaskId: b.id } },
      );
      expect(second.status).toBe(409);
      const body = (await second.json()) as { type: string };
      expect(body.type).toBe('https://tasker.dev/problems/dependency-cycle');
    });

    it('surfaces acknowledgedBlockersOpen on DONE transition with open blockers; overrideBlockers=true succeeds', async () => {
      const target = await createTask('bg-target');
      const blocker = await createTask('bg-blocker');
      await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${target.number}/dependencies`,
        { token: member.accessToken, body: { blockedByTaskId: blocker.id } },
      );

      const move1 = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${target.number}/move`,
        {
          token: member.accessToken,
          body: {
            status: 'DONE',
            position: Positions.between(null, null),
            ifUnchangedSince: target.updatedAt,
          },
        },
      );
      expect(move1.status).toBe(201);
      const blockedBody = (await move1.json()) as {
        status: string;
        acknowledgedBlockersOpen: string[];
      };
      expect(blockedBody.status).not.toBe('DONE');
      expect(blockedBody.acknowledgedBlockersOpen).toEqual([`${projectSlug}-${blocker.number}`]);

      // Retry with override — must succeed. Reload updatedAt because
      // ifUnchangedSince still matches (no move happened yet).
      const move2 = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${target.number}/move`,
        {
          token: member.accessToken,
          body: {
            status: 'DONE',
            position: Positions.between(null, null),
            ifUnchangedSince: target.updatedAt,
            overrideBlockers: true,
          },
        },
      );
      expect(move2.status).toBe(201);
      const movedBody = (await move2.json()) as { status: string };
      expect(movedBody.status).toBe('DONE');
    });
  });

  // ---------------------------------------------------------------------------
  // Checklists
  // ---------------------------------------------------------------------------

  describe('POST/PATCH/DELETE /tasks/:number/checklist', () => {
    it('creates items, toggles checked, reorders via position', async () => {
      const task = await createTask('cl-1');
      const one = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/checklist`,
        { token: member.accessToken, body: { title: 'Step one' } },
      );
      expect(one.status).toBe(201);
      const two = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/checklist`,
        { token: member.accessToken, body: { title: 'Step two' } },
      );
      expect(two.status).toBe(201);

      const items = (await (
        await req(
          baseUrl,
          'GET',
          `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/checklist`,
          { token: member.accessToken },
        )
      ).json()) as Array<{ id: string; position: string; checked: boolean }>;
      expect(items).toHaveLength(2);
      expect(items[0]?.position < (items[1]?.position ?? '')).toBe(true);

      // Toggle the first item.
      const toggle = await req(
        baseUrl,
        'PATCH',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/checklist/${items[0]!.id}`,
        { token: member.accessToken, body: { checked: true } },
      );
      expect(toggle.status).toBe(200);

      // Reorder: move second item BEFORE the first.
      const beforeFirst = Positions.between(null, items[0]!.position);
      const move = await req(
        baseUrl,
        'PATCH',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/checklist/${items[1]!.id}`,
        { token: member.accessToken, body: { position: beforeFirst } },
      );
      expect(move.status).toBe(200);

      const reordered = (await (
        await req(
          baseUrl,
          'GET',
          `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/checklist`,
          { token: member.accessToken },
        )
      ).json()) as Array<{ id: string }>;
      expect(reordered[0]?.id).toBe(items[1]?.id);
    });

    it('empty patch is rejected with 400', async () => {
      const task = await createTask('cl-empty');
      const create = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/checklist`,
        { token: member.accessToken, body: { title: 'x' } },
      );
      const item = (await create.json()) as { id: string };
      const res = await req(
        baseUrl,
        'PATCH',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/checklist/${item.id}`,
        { token: member.accessToken, body: {} },
      );
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  describe('POST/PATCH/DELETE /tasks/:number/comments', () => {
    it('author edits own, sibling MEMBER cannot edit; ADMIN cannot silently edit either', async () => {
      const task = await createTask('cm-1');
      const create = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/comments`,
        { token: member.accessToken, body: { body: 'hello' } },
      );
      expect(create.status).toBe(201);
      const comment = (await create.json()) as { id: string };

      const authorEdit = await req(
        baseUrl,
        'PATCH',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/comments/${comment.id}`,
        { token: member.accessToken, body: { body: 'hello (edited)' } },
      );
      expect(authorEdit.status).toBe(200);

      const memberEdit = await req(
        baseUrl,
        'PATCH',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/comments/${comment.id}`,
        { token: member2.accessToken, body: { body: 'silent-edit' } },
      );
      expect(memberEdit.status).toBe(403);

      const adminEdit = await req(
        baseUrl,
        'PATCH',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/comments/${comment.id}`,
        { token: admin.accessToken, body: { body: 'admin-silent-edit' } },
      );
      expect(adminEdit.status).toBe(403);
    });

    it('MEMBER cannot delete another author, ADMIN can', async () => {
      const task = await createTask('cm-del');
      const create = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/comments`,
        { token: member.accessToken, body: { body: 'to delete' } },
      );
      const comment = (await create.json()) as { id: string };

      const memberDel = await req(
        baseUrl,
        'DELETE',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/comments/${comment.id}`,
        { token: member2.accessToken },
      );
      expect(memberDel.status).toBe(403);
      const problem = (await memberDel.json()) as { type: string };
      expect(problem.type).toBe('https://tasker.dev/problems/comment-delete-forbidden');

      const adminDel = await req(
        baseUrl,
        'DELETE',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/comments/${comment.id}`,
        { token: admin.accessToken },
      );
      expect(adminDel.status).toBe(204);
    });

    it('outsider gets 403 on comment surfaces (tenant isolation)', async () => {
      const task = await createTask('cm-tenant');
      const res = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${task.number}/comments`,
        { token: outsider.accessToken, body: { body: 'nope' } },
      );
      expect(res.status).toBe(403);
    });
  });
});
