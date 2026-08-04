/**
 * Integration coverage for the Task 4.0 comment enhancements: mention
 * resolution + persistence, cross-workspace autocomplete isolation,
 * soft-delete keeping mentions/reactions, and activity emission for
 * create/edit/delete verbs.
 *
 * Boots real Postgres + Redis via Testcontainers so BullMQ enqueues actually
 * hit a live broker (dropped jobs are silently OK since the stub processor
 * only logs). Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const BASE = '/api/v1';
const TEST_TIMEOUT = 240_000;

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

async function register(baseUrl: string, email: string, displayName: string, prisma: PrismaClient) {
  const res = await req(baseUrl, 'POST', '/auth/register', {
    body: { email, password: 'GoodPass123', displayName },
  });
  const body = (await res.json()) as { accessToken: string };
  const user = await prisma.user.findUnique({ where: { email } });
  await prisma.user.update({
    where: { id: user!.id },
    data: { emailVerifiedAt: new Date() },
  });
  return { userId: user!.id, accessToken: body.accessToken };
}

describe('Comments + mentions (integration)', () => {
  let pg: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;

  let owner: { userId: string; accessToken: string };
  let ana: { userId: string; accessToken: string };
  let bob: { userId: string; accessToken: string };
  let outsider: { userId: string; accessToken: string };
  const wsSlug = 'ws-collab';
  const otherSlug = 'ws-other';
  const projectSlug = 'proj';
  let workspaceId: string;

  beforeAll(async () => {
    [pg, redis] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_collab',
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

    const dbUrl = `postgresql://tasker:tasker@${pg.getHost()}:${pg.getMappedPort(5432)}/tasker_collab`;
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'collab-integration-secret-32-chars-min!!!';
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
    baseUrl = `http://127.0.0.1:${(app.getHttpServer() as { address(): { port: number } }).address().port}`;
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

    owner = await register(baseUrl, 'collab-owner@t.test', 'Owner', prisma);
    ana = await register(baseUrl, 'collab-ana@t.test', 'Ana Silva', prisma);
    bob = await register(baseUrl, 'collab-bob@t.test', 'Bob', prisma);
    outsider = await register(baseUrl, 'collab-outsider@t.test', 'Outsider', prisma);

    const wsRes = await req(baseUrl, 'POST', '/workspaces', {
      token: owner.accessToken,
      body: { name: 'Collab', slug: wsSlug },
    });
    workspaceId = ((await wsRes.json()) as { id: string }).id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: ana.userId, role: 'MEMBER' },
        { workspaceId, userId: bob.userId, role: 'MEMBER' },
      ],
    });
    await req(baseUrl, 'POST', `/workspaces/${wsSlug}/projects`, {
      token: owner.accessToken,
      body: { name: 'P', slug: projectSlug, color: '#3b82f6', icon: 'Package' },
    });

    // Second workspace for outsider — they must NOT appear in wsSlug autocomplete.
    const ws2 = await req(baseUrl, 'POST', '/workspaces', {
      token: outsider.accessToken,
      body: { name: 'Other', slug: otherSlug },
    });
    expect(ws2.status).toBe(201);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop()]);
  }, TEST_TIMEOUT);

  async function createTask(title: string): Promise<{ number: number }> {
    const res = await req(baseUrl, 'POST', `/workspaces/${wsSlug}/projects/${projectSlug}/tasks`, {
      token: owner.accessToken,
      body: { title },
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { number: number };
  }

  // ---------------------------------------------------------------------------

  it('POST /comments resolves @mentions and persists CommentMention rows', async () => {
    const task = await createTask('mention-1');
    const res = await req(
      baseUrl,
      'POST',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${task.number}/comments`,
      { token: owner.accessToken, body: { body: 'ping @ana-silva please' } },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; mentions: Array<{ userId: string }> };
    expect(body.mentions.map((m) => m.userId)).toEqual([ana.userId]);

    const stored = await prisma.commentMention.findMany({ where: { commentId: body.id } });
    expect(stored.map((m) => m.mentionedUserId)).toEqual([ana.userId]);
  });

  it('POST /comments emits an Activity row with verb=comment.created', async () => {
    const task = await createTask('mention-activity');
    const res = await req(
      baseUrl,
      'POST',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${task.number}/comments`,
      { token: owner.accessToken, body: { body: 'no mentions' } },
    );
    const c = (await res.json()) as { id: string; taskId: string };
    const activities = await prisma.activity.findMany({
      where: { workspaceId, taskId: c.taskId, verb: 'comment.created' },
    });
    expect(activities.length).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /comments diffs mentions and only enqueues for newly-added', async () => {
    const task = await createTask('mention-edit');
    const create = await req(
      baseUrl,
      'POST',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${task.number}/comments`,
      { token: owner.accessToken, body: { body: 'cc @ana-silva' } },
    );
    const comment = (await create.json()) as { id: string };

    const edit = await req(
      baseUrl,
      'PATCH',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${task.number}/comments/${comment.id}`,
      { token: owner.accessToken, body: { body: 'cc @bob only now' } },
    );
    expect(edit.status).toBe(200);
    const stored = await prisma.commentMention.findMany({ where: { commentId: comment.id } });
    expect(stored.map((m) => m.mentionedUserId)).toEqual([bob.userId]);

    const editActivity = await prisma.activity.findMany({
      where: { workspaceId, verb: 'comment.edited' },
    });
    expect(editActivity.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /comments soft-deletes and preserves CommentMention rows', async () => {
    const task = await createTask('mention-softdel');
    const create = await req(
      baseUrl,
      'POST',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${task.number}/comments`,
      { token: owner.accessToken, body: { body: 'cc @ana-silva' } },
    );
    const comment = (await create.json()) as { id: string };

    const del = await req(
      baseUrl,
      'DELETE',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${task.number}/comments/${comment.id}`,
      { token: owner.accessToken },
    );
    expect(del.status).toBe(204);

    const row = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(row?.deletedAt).not.toBeNull();
    const stored = await prisma.commentMention.findMany({ where: { commentId: comment.id } });
    expect(stored).toHaveLength(1); // preserved (PRD FR-5)
  });

  it('GET /members/mention-search returns workspace members only', async () => {
    const res = await req(baseUrl, 'GET', `/workspaces/${wsSlug}/members/mention-search?q=ana`, {
      token: owner.accessToken,
    });
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ userId: string; slug: string }>;
    expect(list.map((m) => m.userId)).toContain(ana.userId);
    expect(list.map((m) => m.userId)).not.toContain(outsider.userId);
  });

  it('GET /members/mention-search from another workspace never leaks members', async () => {
    // Outsider queries THEIR workspace — must not see ana or bob.
    const res = await req(baseUrl, 'GET', `/workspaces/${otherSlug}/members/mention-search?q=`, {
      token: outsider.accessToken,
    });
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ userId: string }>;
    expect(list.map((m) => m.userId)).not.toContain(ana.userId);
    expect(list.map((m) => m.userId)).not.toContain(bob.userId);
    expect(list.map((m) => m.userId)).toContain(outsider.userId);
  });

  it('POST /comments is idempotent under the same Idempotency-Key', async () => {
    const task = await createTask('idem');
    const key = 'idem-key-abc-123';
    const first = await req(
      baseUrl,
      'POST',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${task.number}/comments`,
      { token: owner.accessToken, body: { body: 'once' }, headers: { 'Idempotency-Key': key } },
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };
    const second = await req(
      baseUrl,
      'POST',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${task.number}/comments`,
      { token: owner.accessToken, body: { body: 'once' }, headers: { 'Idempotency-Key': key } },
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).toBe(firstBody.id);
    const rows = await prisma.comment.count({
      where: { taskId: (await prisma.task.findFirst({ where: { title: 'idem' } }))!.id },
    });
    expect(rows).toBe(1);
  });
});
