/**
 * Integration coverage for the Task 5.0 reactions module: idempotent
 * add/remove, cross-workspace isolation, activity emission, concurrent
 * duplicate-add races (unique-constraint safety).
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
  init: { body?: JsonBody; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
  };
  return fetch(`${baseUrl}${BASE}${path}`, {
    method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

async function register(baseUrl: string, email: string, prisma: PrismaClient) {
  const res = await req(baseUrl, 'POST', '/auth/register', {
    body: { email, password: 'GoodPass123', displayName: email.split('@')[0] },
  });
  const body = (await res.json()) as { accessToken: string };
  const user = await prisma.user.findUnique({ where: { email } });
  await prisma.user.update({ where: { id: user!.id }, data: { emailVerifiedAt: new Date() } });
  return { userId: user!.id, accessToken: body.accessToken };
}

describe('Reactions (integration)', () => {
  let pg: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;

  let owner: { userId: string; accessToken: string };
  let member: { userId: string; accessToken: string };
  let outsider: { userId: string; accessToken: string };
  const wsSlug = 'ws-react';
  const otherSlug = 'ws-oth';
  const projectSlug = 'proj';
  let taskNumber: number;
  let commentId: string;

  beforeAll(async () => {
    [pg, redis] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_react',
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

    const dbUrl = `postgresql://tasker:tasker@${pg.getHost()}:${pg.getMappedPort(5432)}/tasker_react`;
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'react-integration-secret-32-chars-min!!!';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['APP_BASE_URL'] = 'http://localhost:3000';
    process.env['THROTTLE_REGISTER_LIMIT'] = '100';
    process.env['THROTTLE_LOGIN_LIMIT'] = '100';
    process.env['THROTTLE_DEFAULT_LIMIT'] = '10000';

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

    owner = await register(baseUrl, 'react-owner@t.test', prisma);
    member = await register(baseUrl, 'react-member@t.test', prisma);
    outsider = await register(baseUrl, 'react-outsider@t.test', prisma);

    const wsRes = await req(baseUrl, 'POST', '/workspaces', {
      token: owner.accessToken,
      body: { name: 'React', slug: wsSlug },
    });
    const workspaceId = ((await wsRes.json()) as { id: string }).id;
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: 'MEMBER' },
    });
    await req(baseUrl, 'POST', `/workspaces/${wsSlug}/projects`, {
      token: owner.accessToken,
      body: { name: 'P', slug: projectSlug, color: '#3b82f6', icon: 'Package' },
    });
    const taskRes = await req(
      baseUrl,
      'POST',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks`,
      {
        token: owner.accessToken,
        body: { title: 'React target' },
      },
    );
    taskNumber = ((await taskRes.json()) as { number: number }).number;
    const commentRes = await req(
      baseUrl,
      'POST',
      `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${taskNumber}/comments`,
      { token: owner.accessToken, body: { body: 'react here' } },
    );
    commentId = ((await commentRes.json()) as { id: string }).id;

    // Outsider workspace
    await req(baseUrl, 'POST', '/workspaces', {
      token: outsider.accessToken,
      body: { name: 'Other', slug: otherSlug },
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.close();
    await Promise.all([pg?.stop(), redis?.stop()]);
  }, TEST_TIMEOUT);

  function url(emoji?: string): string {
    const base = `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${taskNumber}/comments/${commentId}/reactions`;
    return emoji ? `${base}/${emoji}` : base;
  }

  it('POST adds a row and returns 201', async () => {
    const res = await req(baseUrl, 'POST', url('heart'), { token: member.accessToken });
    expect(res.status).toBe(201);
    const rows = await prisma.commentReaction.findMany({
      where: { commentId, userId: member.userId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.emoji).toBe('heart');
  });

  it('replay of the same POST is idempotent (unique constraint)', async () => {
    // First add already ran in the previous test — replay must not error.
    const res = await req(baseUrl, 'POST', url('heart'), { token: member.accessToken });
    expect(res.status).toBe(201);
    const rows = await prisma.commentReaction.findMany({
      where: { commentId, userId: member.userId, emoji: 'heart' },
    });
    expect(rows).toHaveLength(1);
  });

  it('rejects an unknown emoji with reaction-not-allowed problem', async () => {
    const res = await req(baseUrl, 'POST', url('poop'), { token: member.accessToken });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { type: string };
    expect(body.type).toBe('https://tasker.dev/problems/reaction-not-allowed');
  });

  it('DELETE removes the row and returns 204', async () => {
    const res = await req(baseUrl, 'DELETE', url('heart'), { token: member.accessToken });
    expect(res.status).toBe(204);
    const rows = await prisma.commentReaction.findMany({
      where: { commentId, userId: member.userId, emoji: 'heart' },
    });
    expect(rows).toHaveLength(0);
  });

  it('DELETE on a non-existing reaction is idempotent (204, no error)', async () => {
    const res = await req(baseUrl, 'DELETE', url('rocket'), { token: member.accessToken });
    expect(res.status).toBe(204);
  });

  it('GET returns totals grouped by emoji with count + reactor sample', async () => {
    // Set up two reactions from two different users.
    await req(baseUrl, 'POST', url('heart'), { token: member.accessToken });
    await req(baseUrl, 'POST', url('heart'), { token: owner.accessToken });
    await req(baseUrl, 'POST', url('rocket'), { token: owner.accessToken });

    const res = await req(baseUrl, 'GET', url(), { token: member.accessToken });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as Array<{
      emoji: string;
      count: number;
      reactorSample: Array<{ userId: string; displayName: string }>;
      reactedByMe: boolean;
    }>;
    const heart = summary.find((s) => s.emoji === 'heart')!;
    expect(heart.count).toBe(2);
    expect(heart.reactedByMe).toBe(true);
    const rocket = summary.find((s) => s.emoji === 'rocket')!;
    expect(rocket.count).toBe(1);
    expect(rocket.reactedByMe).toBe(false);
  });

  it('emits activity.reaction.added and activity.reaction.removed rows', async () => {
    const before = await prisma.activity.count({
      where: { verb: { in: ['reaction.added', 'reaction.removed'] } },
    });
    await req(baseUrl, 'POST', url('tada'), { token: member.accessToken });
    await req(baseUrl, 'DELETE', url('tada'), { token: member.accessToken });
    const after = await prisma.activity.count({
      where: { verb: { in: ['reaction.added', 'reaction.removed'] } },
    });
    expect(after - before).toBe(2);
  });

  it('cross-workspace member cannot react (WorkspaceGuard 403)', async () => {
    const res = await req(baseUrl, 'POST', url('heart'), { token: outsider.accessToken });
    expect(res.status).toBe(403);
  });

  it('concurrent duplicate add requests do not create duplicate rows', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        req(baseUrl, 'POST', url('eyes'), { token: member.accessToken }),
      ),
    );
    for (const r of results) expect(r.status).toBeLessThan(500);
    const rows = await prisma.commentReaction.findMany({
      where: { commentId, userId: member.userId, emoji: 'eyes' },
    });
    expect(rows).toHaveLength(1);
  });
});
