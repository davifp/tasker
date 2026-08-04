/**
 * Integration coverage for the Task 6.0 attachments module:
 *   - two-phase upload (sign → PUT to MinIO → confirm)
 *   - download flow (sign GET → HTTP fetch)
 *   - list only surfaces READY rows
 *   - delete moves to DELETING + activity + storage delete
 *   - cross-workspace access is 404
 *   - RBAC: uploader / admin can delete, another member cannot
 *   - janitor sweep drops stale PENDING rows and cleans storage
 *
 * Boots real Postgres + Redis + MinIO. Requires `docker-compose up minio` for
 * MinIO to be reachable at http://localhost:9000. If MinIO is unreachable the
 * suite is skipped (same convention as storage.integration.spec.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, AttachmentStatus } from '@prisma/client';

const BASE = '/api/v1';
const TEST_TIMEOUT = 240_000;
const MINIO_ENDPOINT = 'http://localhost:9000';

interface JsonBody {
  [k: string]: unknown;
}

async function isMinioReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${MINIO_ENDPOINT}/minio/health/live`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
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

async function register(baseUrl: string, email: string, prisma: PrismaClient) {
  const res = await req(baseUrl, 'POST', '/auth/register', {
    body: { email, password: 'GoodPass123', displayName: email.split('@')[0] },
  });
  const body = (await res.json()) as { accessToken: string };
  const user = await prisma.user.findUnique({ where: { email } });
  await prisma.user.update({ where: { id: user!.id }, data: { emailVerifiedAt: new Date() } });
  return { userId: user!.id, accessToken: body.accessToken };
}

describe('Attachments (integration)', () => {
  let pg: StartedTestContainer;
  let redis: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;
  let minioReachable = false;
  let attachmentsService: import('../src/tasks/attachments/attachments.service').AttachmentsService;

  let owner: { userId: string; accessToken: string };
  let member: { userId: string; accessToken: string };
  let outsider: { userId: string; accessToken: string };
  const wsSlug = 'ws-att';
  const otherSlug = 'ws-att-other';
  const projectSlug = 'proj';
  let taskNumber: number;
  let taskId: string;
  let workspaceId: string;

  beforeAll(async () => {
    minioReachable = await isMinioReachable();
    if (!minioReachable) return;

    [pg, redis] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_att',
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

    const dbUrl = `postgresql://tasker:tasker@${pg.getHost()}:${pg.getMappedPort(5432)}/tasker_att`;
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'att-integration-secret-32-chars-min!!!';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['APP_BASE_URL'] = 'http://localhost:3000';
    process.env['THROTTLE_REGISTER_LIMIT'] = '100';
    process.env['THROTTLE_LOGIN_LIMIT'] = '100';
    process.env['THROTTLE_DEFAULT_LIMIT'] = '10000';
    process.env['STORAGE_ENDPOINT'] = MINIO_ENDPOINT;
    process.env['STORAGE_REGION'] = 'us-east-1';
    process.env['STORAGE_BUCKET'] = 'tasker-attachments';
    process.env['STORAGE_ACCESS_KEY_ID'] = 'minioadmin';
    process.env['STORAGE_SECRET_ACCESS_KEY'] = 'minioadmin';
    process.env['STORAGE_FORCE_PATH_STYLE'] = 'true';
    process.env['STORAGE_PUT_URL_TTL_S'] = '60';
    process.env['STORAGE_GET_URL_TTL_S'] = '300';

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
      { AttachmentsService },
    ] = await Promise.all([
      import('../src/app.module'),
      import('@nestjs/testing'),
      import('nestjs-pino'),
      import('../src/common/security/hibp.service'),
      import('../src/common/mail/mail.provider'),
      import('../src/tasks/attachments/attachments.service'),
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
    attachmentsService = app.get(AttachmentsService);

    owner = await register(baseUrl, 'att-owner@t.test', prisma);
    member = await register(baseUrl, 'att-member@t.test', prisma);
    outsider = await register(baseUrl, 'att-outsider@t.test', prisma);

    const wsRes = await req(baseUrl, 'POST', '/workspaces', {
      token: owner.accessToken,
      body: { name: 'Att', slug: wsSlug },
    });
    workspaceId = ((await wsRes.json()) as { id: string }).id;
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
      { token: owner.accessToken, body: { title: 'Attachment target' } },
    );
    const taskBody = (await taskRes.json()) as { number: number; id: string };
    taskNumber = taskBody.number;
    taskId = taskBody.id;

    // Outsider workspace so a cross-tenant check has somewhere to belong.
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

  function url(suffix = ''): string {
    return `/workspaces/${wsSlug}/projects/${projectSlug}/tasks/${taskNumber}/attachments${suffix}`;
  }

  // ---------------------------------------------------------------------------

  it(
    'sign → PUT to MinIO → confirm produces a READY row and emits activity',
    async () => {
      if (!minioReachable) return;

      const payload = 'hello-attachment';
      const sizeBytes = new TextEncoder().encode(payload).byteLength;
      const mime = 'text/plain';

      const signRes = await req(baseUrl, 'POST', url('/sign'), {
        token: member.accessToken,
        body: { filename: 'hello.txt', mime, sizeBytes },
      });
      expect(signRes.status).toBe(201);
      const signed = (await signRes.json()) as {
        attachmentId: string;
        uploadUrl: string;
        storageKey: string;
      };

      const rowBefore = await prisma.attachment.findUnique({ where: { id: signed.attachmentId } });
      expect(rowBefore?.status).toBe(AttachmentStatus.PENDING);

      const putRes = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': mime, 'content-length': String(sizeBytes) },
        body: payload,
      });
      expect(putRes.status).toBeGreaterThanOrEqual(200);
      expect(putRes.status).toBeLessThan(300);

      const confirmRes = await req(baseUrl, 'POST', url(`/${signed.attachmentId}/confirm`), {
        token: member.accessToken,
      });
      expect(confirmRes.status).toBe(201);
      const confirmed = (await confirmRes.json()) as { status: string };
      expect(confirmed.status).toBe('READY');

      const rowAfter = await prisma.attachment.findUnique({ where: { id: signed.attachmentId } });
      expect(rowAfter?.status).toBe(AttachmentStatus.READY);

      const activity = await prisma.activity.findMany({
        where: { workspaceId, taskId, verb: 'attachment.uploaded' },
      });
      expect(activity.length).toBeGreaterThanOrEqual(1);
    },
    TEST_TIMEOUT,
  );

  it(
    'confirm is idempotent — replay returns READY without emitting a new activity row',
    async () => {
      if (!minioReachable) return;

      const payload = 'idem';
      const sizeBytes = new TextEncoder().encode(payload).byteLength;
      const signRes = await req(baseUrl, 'POST', url('/sign'), {
        token: member.accessToken,
        body: { filename: 'idem.txt', mime: 'text/plain', sizeBytes },
      });
      const signed = (await signRes.json()) as { attachmentId: string; uploadUrl: string };
      await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain', 'content-length': String(sizeBytes) },
        body: payload,
      });
      await req(baseUrl, 'POST', url(`/${signed.attachmentId}/confirm`), {
        token: member.accessToken,
      });
      const before = await prisma.activity.count({
        where: { workspaceId, verb: 'attachment.uploaded' },
      });
      const replay = await req(baseUrl, 'POST', url(`/${signed.attachmentId}/confirm`), {
        token: member.accessToken,
      });
      expect(replay.status).toBe(201);
      const after = await prisma.activity.count({
        where: { workspaceId, verb: 'attachment.uploaded' },
      });
      expect(after - before).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it('list surfaces only READY rows and orders newest-first', async () => {
    if (!minioReachable) return;

    const listRes = await req(baseUrl, 'GET', url(), { token: member.accessToken });
    expect(listRes.status).toBe(200);
    const page = (await listRes.json()) as {
      items: Array<{ id: string; status: string; createdAt: string }>;
      nextCursor: string | null;
    };
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) expect(item.status).toBe('READY');
    const times = page.items.map((i) => new Date(i.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]!);
    }
  });

  it(
    'download returns a signed GET url that fetches the original bytes',
    async () => {
      if (!minioReachable) return;

      const payload = 'download-body-9273';
      const sizeBytes = new TextEncoder().encode(payload).byteLength;
      const signRes = await req(baseUrl, 'POST', url('/sign'), {
        token: owner.accessToken,
        body: { filename: 'dl.txt', mime: 'text/plain', sizeBytes },
      });
      const signed = (await signRes.json()) as { attachmentId: string; uploadUrl: string };
      await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain', 'content-length': String(sizeBytes) },
        body: payload,
      });
      await req(baseUrl, 'POST', url(`/${signed.attachmentId}/confirm`), {
        token: owner.accessToken,
      });

      const dlRes = await req(baseUrl, 'GET', url(`/${signed.attachmentId}/download`), {
        token: member.accessToken,
      });
      expect(dlRes.status).toBe(200);
      const { url: getUrl } = (await dlRes.json()) as { url: string };
      const fetched = await fetch(getUrl);
      expect(fetched.status).toBe(200);
      expect(await fetched.text()).toBe(payload);
    },
    TEST_TIMEOUT,
  );

  it(
    'uploader can delete their own attachment; row goes to DELETING and activity is emitted',
    async () => {
      if (!minioReachable) return;

      const sizeBytes = 4;
      const signRes = await req(baseUrl, 'POST', url('/sign'), {
        token: member.accessToken,
        body: { filename: 'gone.txt', mime: 'text/plain', sizeBytes },
      });
      const signed = (await signRes.json()) as { attachmentId: string; uploadUrl: string };
      await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain', 'content-length': String(sizeBytes) },
        body: 'xxxx',
      });
      await req(baseUrl, 'POST', url(`/${signed.attachmentId}/confirm`), {
        token: member.accessToken,
      });

      const delRes = await req(baseUrl, 'DELETE', url(`/${signed.attachmentId}`), {
        token: member.accessToken,
      });
      expect(delRes.status).toBe(204);
      const row = await prisma.attachment.findUnique({ where: { id: signed.attachmentId } });
      expect(row?.status).toBe(AttachmentStatus.DELETING);
      expect(row?.deletedAt).not.toBeNull();
      const removed = await prisma.activity.count({
        where: { workspaceId, verb: 'attachment.removed' },
      });
      expect(removed).toBeGreaterThanOrEqual(1);
    },
    TEST_TIMEOUT,
  );

  it(
    "a member who did not upload cannot delete another member's attachment (403)",
    async () => {
      if (!minioReachable) return;

      const sizeBytes = 4;
      const signRes = await req(baseUrl, 'POST', url('/sign'), {
        token: member.accessToken,
        body: { filename: 'mine.txt', mime: 'text/plain', sizeBytes },
      });
      const signed = (await signRes.json()) as { attachmentId: string; uploadUrl: string };
      await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain', 'content-length': String(sizeBytes) },
        body: 'yyyy',
      });
      await req(baseUrl, 'POST', url(`/${signed.attachmentId}/confirm`), {
        token: member.accessToken,
      });

      // Create a second member who is NOT the uploader.
      const bystander = await register(baseUrl, 'att-bystander@t.test', prisma);
      await prisma.workspaceMember.create({
        data: { workspaceId, userId: bystander.userId, role: 'MEMBER' },
      });

      const delRes = await req(baseUrl, 'DELETE', url(`/${signed.attachmentId}`), {
        token: bystander.accessToken,
      });
      expect(delRes.status).toBe(403);
      const row = await prisma.attachment.findUnique({ where: { id: signed.attachmentId } });
      expect(row?.status).toBe(AttachmentStatus.READY);
    },
    TEST_TIMEOUT,
  );

  it(
    "an OWNER can delete another member's attachment",
    async () => {
      if (!minioReachable) return;

      const sizeBytes = 4;
      const signRes = await req(baseUrl, 'POST', url('/sign'), {
        token: member.accessToken,
        body: { filename: 'admin-del.txt', mime: 'text/plain', sizeBytes },
      });
      const signed = (await signRes.json()) as { attachmentId: string; uploadUrl: string };
      await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain', 'content-length': String(sizeBytes) },
        body: 'zzzz',
      });
      await req(baseUrl, 'POST', url(`/${signed.attachmentId}/confirm`), {
        token: member.accessToken,
      });

      const delRes = await req(baseUrl, 'DELETE', url(`/${signed.attachmentId}`), {
        token: owner.accessToken,
      });
      expect(delRes.status).toBe(204);
      const row = await prisma.attachment.findUnique({ where: { id: signed.attachmentId } });
      expect(row?.status).toBe(AttachmentStatus.DELETING);
    },
    TEST_TIMEOUT,
  );

  it('cross-workspace user hitting the attachments endpoints is blocked (403 WorkspaceGuard)', async () => {
    if (!minioReachable) return;

    const res = await req(baseUrl, 'POST', url('/sign'), {
      token: outsider.accessToken,
      body: { filename: 'x.txt', mime: 'text/plain', sizeBytes: 1 },
    });
    expect(res.status).toBe(403);
  });

  it('sign rejects a disallowed mime type at the schema layer (422)', async () => {
    if (!minioReachable) return;

    const res = await req(baseUrl, 'POST', url('/sign'), {
      token: member.accessToken,
      body: { filename: 'exec.exe', mime: 'application/x-msdownload', sizeBytes: 1024 },
    });
    // ZodValidationPipe rejects with 422.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it(
    'sweepOrphanPending drops PENDING rows older than the threshold and skips fresh ones',
    async () => {
      if (!minioReachable) return;

      const fresh = await req(baseUrl, 'POST', url('/sign'), {
        token: member.accessToken,
        body: { filename: 'fresh.txt', mime: 'text/plain', sizeBytes: 1 },
      });
      const freshId = ((await fresh.json()) as { attachmentId: string }).attachmentId;

      const stale = await req(baseUrl, 'POST', url('/sign'), {
        token: member.accessToken,
        body: { filename: 'stale.txt', mime: 'text/plain', sizeBytes: 1 },
      });
      const staleId = ((await stale.json()) as { attachmentId: string }).attachmentId;

      // Backdate the stale row so it looks older than the sweep threshold.
      await prisma.attachment.update({
        where: { id: staleId },
        data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
      });

      const cutoff = new Date(Date.now() - 30 * 60 * 1000);
      const result = await attachmentsService.sweepOrphanPending(cutoff);
      expect(result.swept).toBeGreaterThanOrEqual(1);

      const staleRow = await prisma.attachment.findUnique({ where: { id: staleId } });
      expect(staleRow).toBeNull();
      const freshRow = await prisma.attachment.findUnique({ where: { id: freshId } });
      expect(freshRow).not.toBeNull();
      expect(freshRow?.status).toBe(AttachmentStatus.PENDING);
    },
    TEST_TIMEOUT,
  );
});
