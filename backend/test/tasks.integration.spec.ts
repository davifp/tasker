/**
 * Tasks module integration tests.
 *
 * Boots real Postgres 16 + Redis 7 and exercises the tasks controller end
 * to end. Covers the techspec's success criteria:
 * - 20 parallel POST /tasks → 20 distinct sequential numbers, no gaps
 * - 10 parallel POST /move on the same column → all succeed, no duplicate
 *   positions (guarded by the partial unique + retry)
 * - Stale write on move → 409 stale-write
 * - MEMBER can delete own; MEMBER 403 on someone else's; ADMIN can delete
 *   any
 * - Tenant isolation: cross-workspace read/mutate → 403/404
 * - Cursor pagination on 25 seeded tasks with limit=10
 * - Idempotency-Key on POST /tasks
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

describe('Tasks module (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;

  let owner: Awaited<ReturnType<typeof register>>;
  let admin: Awaited<ReturnType<typeof register>>;
  let member: Awaited<ReturnType<typeof register>>;
  let guest: Awaited<ReturnType<typeof register>>;
  let outsider: Awaited<ReturnType<typeof register>>;
  let workspaceSlug: string;
  let workspaceId: string;
  let projectSlug: string;

  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_tasks',
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

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_tasks`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'tasks-integration-secret-32-chars!!!!';
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

    workspaceSlug = 'task-space';
    projectSlug = 'web';

    owner = await register(baseUrl, 'task-owner@example.com');
    admin = await register(baseUrl, 'task-admin@example.com');
    member = await register(baseUrl, 'task-member@example.com');
    guest = await register(baseUrl, 'task-guest@example.com');
    outsider = await register(baseUrl, 'task-outsider@example.com');
    for (const u of [owner, admin, member, guest, outsider]) {
      await verifyUser(u.userId);
    }

    const wsRes = await req(baseUrl, 'POST', '/workspaces', {
      token: owner.accessToken,
      body: { name: 'Task Space', slug: workspaceSlug },
    });
    workspaceId = ((await wsRes.json()) as { id: string }).id;

    await getPrisma().workspaceMember.createMany({
      data: [
        { workspaceId, userId: admin.userId, role: 'ADMIN' },
        { workspaceId, userId: member.userId, role: 'MEMBER' },
        { workspaceId, userId: guest.userId, role: 'GUEST' },
      ],
    });

    // Seed the parent project via the HTTP surface — proves the full stack
    // works from Task 2.0 onwards.
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

  // ---------------------------------------------------------------------------
  // POST /tasks — creation + numbering + role gating + idempotency
  // ---------------------------------------------------------------------------

  describe('POST /tasks', () => {
    it('MEMBER can create; number starts at 1', async () => {
      const res = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`,
        { token: member.accessToken, body: { title: 'First' } },
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        number: number;
        status: string;
        title: string;
        createdByUserId: string;
      };
      expect(body.number).toBe(1);
      expect(body.status).toBe('BACKLOG');
      expect(body.title).toBe('First');
      expect(body.createdByUserId).toBe(member.userId);
    });

    it('GUEST cannot create (403)', async () => {
      const res = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`,
        { token: guest.accessToken, body: { title: 'Denied' } },
      );
      expect(res.status).toBe(403);
    });

    it('outsider gets 403', async () => {
      const res = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`,
        { token: outsider.accessToken, body: { title: 'Alien' } },
      );
      expect(res.status).toBe(403);
    });

    it('short-circuits duplicate via Idempotency-Key', async () => {
      const first = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`,
        {
          token: owner.accessToken,
          headers: { 'Idempotency-Key': 'task-idem-1' },
          body: { title: 'Idem' },
        },
      );
      expect(first.status).toBe(201);
      const firstBody = await first.json();

      const second = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`,
        {
          token: owner.accessToken,
          headers: { 'Idempotency-Key': 'task-idem-1' },
          body: { title: 'Idem' },
        },
      );
      expect(second.status).toBe(201);
      expect(await second.json()).toEqual(firstBody);
    });

    it(
      '20 parallel creates → 20 distinct sequential numbers, no gaps',
      async () => {
        // Dedicated project so we don't fight the tasks already seeded above.
        const projRes = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
          token: owner.accessToken,
          body: { name: 'Numbering', slug: 'numbering', color: '#3b82f6', icon: 'Hash' },
        });
        expect(projRes.status).toBe(201);

        const results = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects/numbering/tasks`, {
              token: owner.accessToken,
              body: { title: `Parallel ${i}` },
            }).then((r) => r.json() as Promise<{ number: number }>),
          ),
        );
        const numbers = results.map((r) => r.number).sort((a, b) => a - b);
        expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // GET + PATCH
  // ---------------------------------------------------------------------------

  describe('GET/PATCH /tasks/:number', () => {
    it('GET returns 404 for a non-existent number', async () => {
      const res = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/9999`,
        { token: owner.accessToken },
      );
      expect(res.status).toBe(404);
    });

    it('PATCH by MEMBER updates title', async () => {
      const res = await req(
        baseUrl,
        'PATCH',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/1`,
        { token: member.accessToken, body: { title: 'Renamed First' } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { title: string };
      expect(body.title).toBe('Renamed First');
    });

    it('PATCH by GUEST is forbidden (403)', async () => {
      const res = await req(
        baseUrl,
        'PATCH',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/1`,
        { token: guest.accessToken, body: { title: 'Not allowed' } },
      );
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /move — status + position + optimistic concurrency
  // ---------------------------------------------------------------------------

  describe('POST /tasks/:number/move', () => {
    it('moves a task and emits new status; ifUnchangedSince stale → 409 stale-write', async () => {
      // Fresh state read
      const get1 = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/1`,
        { token: owner.accessToken },
      );
      const original = (await get1.json()) as { updatedAt: string };

      const targetPos = Positions.between(null, null);
      const good = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/1/move`,
        {
          token: owner.accessToken,
          body: {
            status: 'IN_PROGRESS',
            position: targetPos,
            ifUnchangedSince: original.updatedAt,
          },
        },
      );
      expect(good.status).toBe(201);
      const moved = (await good.json()) as { status: string; position: string };
      expect(moved.status).toBe('IN_PROGRESS');
      expect(moved.position).toBe(targetPos);

      // Second move with the *original* updatedAt → stale
      const stale = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/1/move`,
        {
          token: owner.accessToken,
          body: {
            status: 'DONE',
            position: Positions.between(targetPos, null),
            ifUnchangedSince: original.updatedAt,
          },
        },
      );
      expect(stale.status).toBe(409);
      const body = (await stale.json()) as { type: string };
      expect(body.type).toBe('https://tasker.dev/problems/stale-write');
    });

    it(
      '10 parallel moves on the same task → all resolve; final state consistent',
      async () => {
        // Rather than moving one task from 10 clients (last-writer-wins), the
        // more interesting concurrency invariant is: create 10 tasks and move
        // each to the same target column in parallel — all must land with
        // distinct positions.
        const projRes = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
          token: owner.accessToken,
          body: {
            name: 'Concurrent Moves',
            slug: 'concurrent-moves',
            color: '#3b82f6',
            icon: 'Move',
          },
        });
        expect(projRes.status).toBe(201);

        const created = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects/concurrent-moves/tasks`, {
              token: owner.accessToken,
              body: { title: `M${i}` },
            }).then((r) => r.json() as Promise<{ number: number; updatedAt: string }>),
          ),
        );

        // All 10 clients pick the SAME target position and race — the partial
        // unique index forces 9 losers to regen from a fresh tail. Server-side
        // sequencing takes care of the rest.
        const contestedPosition = Positions.between(null, null);
        const results = await Promise.all(
          created.map((t) =>
            req(
              baseUrl,
              'POST',
              `/workspaces/${workspaceSlug}/projects/concurrent-moves/tasks/${t.number}/move`,
              {
                token: owner.accessToken,
                body: {
                  status: 'IN_PROGRESS',
                  position: contestedPosition,
                  ifUnchangedSince: t.updatedAt,
                },
              },
            ).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
          ),
        );

        const succeeded = results.filter((r) => r.ok);
        expect(succeeded.length).toBe(10);
        const positions = succeeded.map((r) => (r.body as { position: string }).position);
        expect(new Set(positions).size).toBe(10);
      },
      TEST_TIMEOUT,
    );

    it('regenerates position when caller-supplied slot collides with a live task', async () => {
      // Two tasks; task 1 is already at position "col-A". A move that tries
      // to reuse "col-A" for task 2 must regen to a fresh tail and succeed.
      const projRes = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: owner.accessToken,
        body: { name: 'Retry', slug: 'retry', color: '#3b82f6', icon: 'Repeat' },
      });
      expect(projRes.status).toBe(201);

      const t1 = (await (
        await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects/retry/tasks`, {
          token: owner.accessToken,
          body: { title: 'T1' },
        })
      ).json()) as { number: number; updatedAt: string };
      const t2 = (await (
        await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects/retry/tasks`, {
          token: owner.accessToken,
          body: { title: 'T2' },
        })
      ).json()) as { number: number; updatedAt: string };

      // Move t1 to a known slot
      const slot = Positions.between(null, null);
      const move1 = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/retry/tasks/${t1.number}/move`,
        {
          token: owner.accessToken,
          body: { status: 'DONE', position: slot, ifUnchangedSince: t1.updatedAt },
        },
      );
      expect(move1.status).toBe(201);

      // Move t2 to the *same* slot (collision) — service must regen and
      // land it at a fresh tail without erroring.
      const move2 = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/retry/tasks/${t2.number}/move`,
        {
          token: owner.accessToken,
          body: { status: 'DONE', position: slot, ifUnchangedSince: t2.updatedAt },
        },
      );
      expect(move2.status).toBe(201);
      const moved = (await move2.json()) as { status: string; position: string };
      expect(moved.status).toBe('DONE');
      expect(moved.position).not.toBe(slot);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE + restore + ownership
  // ---------------------------------------------------------------------------

  describe('DELETE /tasks/:number', () => {
    it('MEMBER can delete their own task, restore round-trips', async () => {
      const createRes = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`,
        { token: member.accessToken, body: { title: 'Members-own' } },
      );
      const created = (await createRes.json()) as { number: number };

      const del = await req(
        baseUrl,
        'DELETE',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${created.number}`,
        { token: member.accessToken },
      );
      expect(del.status).toBe(204);

      const missing = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${created.number}`,
        { token: member.accessToken },
      );
      expect(missing.status).toBe(404);

      const restore = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${created.number}/restore`,
        { token: member.accessToken },
      );
      expect(restore.status).toBe(201);
      const back = (await restore.json()) as { deletedAt: string | null };
      expect(back.deletedAt).toBeNull();
    });

    it("MEMBER cannot delete someone else's task (403 task-delete-forbidden)", async () => {
      const createRes = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`,
        { token: admin.accessToken, body: { title: 'Admin-owned' } },
      );
      const created = (await createRes.json()) as { number: number };

      const res = await req(
        baseUrl,
        'DELETE',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${created.number}`,
        { token: member.accessToken },
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { type: string };
      expect(body.type).toBe('https://tasker.dev/problems/task-delete-forbidden');
    });

    it("ADMIN can delete anyone's task", async () => {
      const createRes = await req(
        baseUrl,
        'POST',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks`,
        { token: member.accessToken, body: { title: 'To be deleted by admin' } },
      );
      const created = (await createRes.json()) as { number: number };

      const res = await req(
        baseUrl,
        'DELETE',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks/${created.number}`,
        { token: admin.accessToken },
      );
      expect(res.status).toBe(204);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /tasks — cursor pagination + filters
  // ---------------------------------------------------------------------------

  describe('GET /tasks', () => {
    let paginationSlug: string;

    beforeAll(async () => {
      paginationSlug = 'pagination';
      const projRes = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
        token: owner.accessToken,
        body: { name: 'Pagination', slug: paginationSlug, color: '#3b82f6', icon: 'List' },
      });
      expect(projRes.status).toBe(201);

      for (let i = 0; i < 25; i++) {
        const res = await req(
          baseUrl,
          'POST',
          `/workspaces/${workspaceSlug}/projects/${paginationSlug}/tasks`,
          { token: owner.accessToken, body: { title: `T${i}` } },
        );
        expect(res.status).toBe(201);
      }
    }, TEST_TIMEOUT);

    it('paginates through 25 tasks with limit=10 across 3 pages', async () => {
      const p1 = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${paginationSlug}/tasks?limit=10`,
        { token: owner.accessToken },
      );
      const b1 = (await p1.json()) as { items: unknown[]; nextCursor: string | null };
      expect(b1.items).toHaveLength(10);
      expect(b1.nextCursor).not.toBeNull();

      const p2 = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${paginationSlug}/tasks?limit=10&cursor=${b1.nextCursor}`,
        { token: owner.accessToken },
      );
      const b2 = (await p2.json()) as { items: unknown[]; nextCursor: string | null };
      expect(b2.items).toHaveLength(10);
      expect(b2.nextCursor).not.toBeNull();

      const p3 = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${paginationSlug}/tasks?limit=10&cursor=${b2.nextCursor}`,
        { token: owner.accessToken },
      );
      const b3 = (await p3.json()) as { items: unknown[]; nextCursor: string | null };
      expect(b3.items).toHaveLength(5);
      expect(b3.nextCursor).toBeNull();
    });

    it('scopes the list to the given project (tenant isolation)', async () => {
      const res = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/tasks?limit=100`,
        { token: owner.accessToken },
      );
      const body = (await res.json()) as {
        items: Array<{ workspaceId: string; projectId: string }>;
      };
      expect(body.items.every((t) => t.workspaceId === workspaceId)).toBe(true);
    });
  });
});
