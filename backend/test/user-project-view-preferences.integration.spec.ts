/**
 * UserProjectViewPreferences module integration tests.
 *
 * Boots real Postgres 16 + Redis 7 and exercises the preferences controller
 * end to end. Covers the techspec's success criteria:
 * - GET returns `{}` on first access (never 404).
 * - PUT { defaultView } → 200 with the merged payload; subsequent GET matches.
 * - Idempotency: same body twice → same response.
 * - Unknown keys are stripped (Zod default `.strip()` → 200 with the key gone).
 * - Invalid enum value → 400 with RFC 7807 Problem Details body.
 * - User isolation: A writes prefs, B in the same project GETs `{}`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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

describe('UserProjectViewPreferences module (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;

  let owner: Awaited<ReturnType<typeof register>>;
  let member: Awaited<ReturnType<typeof register>>;
  let workspaceSlug: string;
  let projectSlug: string;

  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_prefs',
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

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_prefs`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'prefs-integration-secret-32-chars!!!!';
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

    workspaceSlug = 'prefs-space';
    projectSlug = 'prefs-web';

    owner = await register(baseUrl, 'prefs-owner@example.com');
    member = await register(baseUrl, 'prefs-member@example.com');
    for (const u of [owner, member]) {
      await verifyUser(u.userId);
    }

    const wsRes = await req(baseUrl, 'POST', '/workspaces', {
      token: owner.accessToken,
      body: { name: 'Prefs Space', slug: workspaceSlug },
    });
    expect(wsRes.status).toBe(201);
    const workspaceId = ((await wsRes.json()) as { id: string }).id;

    // Bring the second user into the workspace as MEMBER so both A and B
    // can hit the preferences endpoints on the same project. The isolation
    // test then proves the row is scoped to the caller's userId.
    await getPrisma().workspaceMember.createMany({
      data: [{ workspaceId, userId: member.userId, role: 'MEMBER' }],
    });

    const projRes = await req(baseUrl, 'POST', `/workspaces/${workspaceSlug}/projects`, {
      token: owner.accessToken,
      body: { name: 'Prefs Web', slug: projectSlug, color: '#3b82f6', icon: 'Package' },
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
  // GET — empty-first behaviour
  // ---------------------------------------------------------------------------

  describe('GET /me/view-preferences', () => {
    it('returns `{}` on first access (never 404)', async () => {
      const res = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({});
    });

    it('404s when the project slug is unknown (not 200/{})', async () => {
      const res = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/does-not-exist/me/view-preferences`,
        { token: owner.accessToken },
      );
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // PUT — upsert + merge + idempotency + validation
  // ---------------------------------------------------------------------------

  describe('PUT /me/view-preferences', () => {
    it('PUT { defaultView: "list" } returns the merged payload and GET mirrors it', async () => {
      const put = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken, body: { defaultView: 'list' } },
      );
      expect(put.status).toBe(200);
      const putBody = (await put.json()) as Record<string, unknown>;
      expect(putBody).toEqual({ defaultView: 'list' });

      const get = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken },
      );
      expect(get.status).toBe(200);
      expect(await get.json()).toEqual({ defaultView: 'list' });
    });

    it('idempotent: same body twice → same response, no state divergence', async () => {
      const body = { defaultView: 'timeline' as const, timeline: { windowWeeks: 4 as const } };
      const first = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken, body },
      );
      expect(first.status).toBe(200);
      const firstBody = await first.json();

      const second = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken, body },
      );
      expect(second.status).toBe(200);
      // Response payload is stable across repeats. `updatedAt` bumps in the
      // DB but is not part of the response schema — good; the client cache
      // stays byte-identical.
      expect(await second.json()).toEqual(firstBody);
    });

    it('shallow-merges into the existing row, replacing whole sub-objects', async () => {
      // Start from a known state: list branch present + defaultView.
      const seed = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        {
          token: owner.accessToken,
          body: {
            defaultView: 'list',
            list: {
              columns: ['title', 'assignee'],
              hidden: ['status'],
              sort: { by: 'title', dir: 'asc' },
            },
          },
        },
      );
      expect(seed.status).toBe(200);

      // Patch only `timeline` — the `list` and `defaultView` branches must
      // survive untouched.
      const patch = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken, body: { timeline: { windowWeeks: 2 } } },
      );
      expect(patch.status).toBe(200);
      const merged = (await patch.json()) as {
        defaultView?: string;
        list?: { columns: string[] };
        timeline?: { windowWeeks: number };
      };
      expect(merged.defaultView).toBe('list');
      expect(merged.list?.columns).toEqual(['title', 'assignee']);
      expect(merged.timeline).toEqual({ windowWeeks: 2 });

      // Patch `list` with a shrunk column set — the whole sub-object is
      // replaced, not deep-merged (columns=['title'], hidden=[]).
      const shrink = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        {
          token: owner.accessToken,
          body: {
            list: {
              columns: ['title'],
              hidden: [],
              sort: { by: 'dueDate', dir: 'desc' },
            },
          },
        },
      );
      const shrunk = (await shrink.json()) as { list?: { columns: string[]; hidden: string[] } };
      expect(shrunk.list?.columns).toEqual(['title']);
      expect(shrunk.list?.hidden).toEqual([]);
    });

    it('strips unknown top-level keys → 200 with the key gone (Zod .strip())', async () => {
      // The Zod schema is `.strip()`, not `.strict()`. Chosen so a mixed-
      // version client can send an experimental key without breaking a
      // rolling deploy — the older backend silently discards the unknown
      // key and returns 200 with the sanitized payload.
      const res = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        {
          token: owner.accessToken,
          body: { defaultView: 'backlog', experimentalKey: { nested: 42 } },
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.defaultView).toBe('backlog');
      expect('experimentalKey' in body).toBe(false);
    });

    it('rejects an invalid `defaultView` enum with 400 + Problem Details', async () => {
      const res = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken, body: { defaultView: 'kanban' } },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { type?: string; title?: string; status?: number };
      // Global ProblemDetailsFilter emits RFC 7807 shape; nestjs-zod raises a
      // ZodValidationException that the filter converts into `type`/`title`/
      // `status` — the exact `type` URL is bikeshed-scoped to the filter,
      // but `status: 400` and a `title` MUST be present.
      expect(body.status).toBe(400);
      expect(typeof body.title).toBe('string');
      expect(typeof body.type).toBe('string');
    });

    it('rejects `timeline.windowWeeks: 3` (outside {2, 4}) with 400', async () => {
      const res = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken, body: { timeline: { windowWeeks: 3 } } },
      );
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // User isolation — the (userId, projectId) key means member B can't read
  // owner A's row, even though both are members of the same project.
  // ---------------------------------------------------------------------------

  describe('User isolation across the same project', () => {
    it("member B in the same project GETs `{}`, not owner A's row", async () => {
      // Owner A writes a distinctive marker; member B's read must NOT see it.
      const write = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        {
          token: owner.accessToken,
          body: { defaultView: 'calendar', timeline: { windowWeeks: 4 } },
        },
      );
      expect(write.status).toBe(200);

      const readB = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: member.accessToken },
      );
      expect(readB.status).toBe(200);
      const bodyB = (await readB.json()) as Record<string, unknown>;
      // Member B has never written; their view of the row is `{}`.
      expect(bodyB).toEqual({});

      // Meanwhile owner A still sees their own row.
      const readA = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken },
      );
      const bodyA = (await readA.json()) as { defaultView?: string };
      expect(bodyA.defaultView).toBe('calendar');
    });

    it("member B's PUT creates B's own row, doesn't stomp owner A's", async () => {
      const putB = await req(
        baseUrl,
        'PUT',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: member.accessToken, body: { defaultView: 'backlog' } },
      );
      expect(putB.status).toBe(200);
      const bodyB = (await putB.json()) as Record<string, unknown>;
      expect(bodyB).toEqual({ defaultView: 'backlog' });

      // Owner A's row still carries the calendar preference from the previous
      // test — B's write did not overwrite A's row.
      const readA = await req(
        baseUrl,
        'GET',
        `/workspaces/${workspaceSlug}/projects/${projectSlug}/me/view-preferences`,
        { token: owner.accessToken },
      );
      const bodyA = (await readA.json()) as { defaultView?: string };
      expect(bodyA.defaultView).toBe('calendar');
    });
  });
});
