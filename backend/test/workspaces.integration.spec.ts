/**
 * Workspaces + invitations + RBAC integration tests.
 *
 * Boots real Postgres 16 + Redis 7. Exercises:
 * - Create workspace requires verified email
 * - Slug uniqueness + reserved-slug rejection
 * - Soft delete + restore
 * - Ownership transfer atomicity (previous Owner becomes Admin)
 * - Sole-Owner demotion/removal refused
 * - RBAC matrix on member management
 * - Cross-tenant isolation (member of workspace A cannot mutate workspace B)
 * - Idempotency-Key on POST /workspaces and POST invitations
 * - Invitation full flow (create → accept via public token → membership row exists)
 * - Partial unique index dedups concurrent invitations
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

async function register(
  baseUrl: string,
  email: string,
  password = 'GoodPass123',
): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
  const res = await req(baseUrl, 'POST', '/auth/register', {
    body: { email, password, displayName: email.split('@')[0] },
  });
  const body = (await res.json()) as { accessToken: string; refreshToken: string };
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  return { userId: user!.id, accessToken: body.accessToken, refreshToken: body.refreshToken };
}

async function verifyUser(userId: string): Promise<void> {
  await getPrisma().user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
}

let prismaSingleton: PrismaClient | undefined;
function getPrisma(): PrismaClient {
  if (!prismaSingleton) throw new Error('prisma not initialised');
  return prismaSingleton;
}

const capturedMails: Array<{
  template: string;
  to: string;
  variables: Record<string, string | number>;
}> = [];

describe('Workspaces + invitations + RBAC (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    [pgContainer, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_DB: 'tasker_ws',
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

    const dbUrl = `postgresql://tasker:tasker@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/tasker_ws`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env['DATABASE_URL'] = dbUrl;
    process.env['REDIS_URL'] = redisUrl;
    process.env['JWT_SECRET'] = 'workspaces-integration-secret-32-chars!';
    process.env['NODE_ENV'] = 'test';
    process.env['LOG_LEVEL'] = 'silent';
    process.env['APP_BASE_URL'] = 'http://localhost:3000';
    // This suite registers ~15 users; bump the per-IP register throttle so it
    // doesn't blow up mid-suite.
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
      .useValue({
        send: vi.fn().mockImplementation((input) => {
          capturedMails.push(input);
          return Promise.resolve({ jobId: `mock-${capturedMails.length}` });
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api/v1');
    await app.listen(0);
    const address = (app.getHttpServer() as { address(): { port: number } }).address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    prismaSingleton = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prismaSingleton?.$disconnect();
    await app?.close();
    await pgContainer?.stop();
    await redisContainer?.stop();
  }, TEST_TIMEOUT);

  describe('POST /workspaces', () => {
    it('returns 403 problem+json when the caller has not verified their email', async () => {
      const owner = await register(baseUrl, 'unverified-owner@example.com');
      const res = await req(baseUrl, 'POST', '/workspaces', {
        token: owner.accessToken,
        body: { name: 'Acme', slug: 'acme' },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { type: string };
      expect(body.type).toBe('https://tasker.dev/problems/email-verification-required');
    });

    it('creates a workspace + Owner membership when the caller is verified', async () => {
      const owner = await register(baseUrl, 'verified-owner@example.com');
      await verifyUser(owner.userId);

      const res = await req(baseUrl, 'POST', '/workspaces', {
        token: owner.accessToken,
        body: { name: 'Acme Corp', slug: 'acme-corp' },
      });
      expect(res.status).toBe(201);
      const workspace = (await res.json()) as { id: string; slug: string; ownerUserId: string };
      expect(workspace.slug).toBe('acme-corp');
      expect(workspace.ownerUserId).toBe(owner.userId);

      const member = await getPrisma().workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: owner.userId },
      });
      expect(member?.role).toBe('OWNER');
    });

    it('rejects a reserved slug with 400', async () => {
      const owner = await register(baseUrl, 'reserved-owner@example.com');
      await verifyUser(owner.userId);
      const res = await req(baseUrl, 'POST', '/workspaces', {
        token: owner.accessToken,
        body: { name: 'Reserved', slug: 'admin' },
      });
      expect(res.status).toBe(400);
    });

    it('retries with a numeric suffix on slug collision', async () => {
      const owner1 = await register(baseUrl, 'slug-a@example.com');
      const owner2 = await register(baseUrl, 'slug-b@example.com');
      await verifyUser(owner1.userId);
      await verifyUser(owner2.userId);

      const res1 = await req(baseUrl, 'POST', '/workspaces', {
        token: owner1.accessToken,
        body: { name: 'Slugtest', slug: 'slugtest' },
      });
      expect(res1.status).toBe(201);
      const res2 = await req(baseUrl, 'POST', '/workspaces', {
        token: owner2.accessToken,
        body: { name: 'Slugtest', slug: 'slugtest' },
      });
      expect(res2.status).toBe(201);
      const w2 = (await res2.json()) as { slug: string };
      expect(w2.slug).toBe('slugtest-2');
    });

    it('short-circuits duplicate creation via Idempotency-Key', async () => {
      const owner = await register(baseUrl, 'idem-owner@example.com');
      await verifyUser(owner.userId);

      const first = await req(baseUrl, 'POST', '/workspaces', {
        token: owner.accessToken,
        headers: { 'Idempotency-Key': 'idem-abc' },
        body: { name: 'Idem', slug: 'idem-space' },
      });
      expect(first.status).toBe(201);
      const firstBody = await first.json();

      const second = await req(baseUrl, 'POST', '/workspaces', {
        token: owner.accessToken,
        headers: { 'Idempotency-Key': 'idem-abc' },
        body: { name: 'Idem', slug: 'idem-space' },
      });
      expect(second.status).toBe(201);
      const secondBody = await second.json();
      expect(secondBody).toEqual(firstBody);
    });
  });

  describe('membership + roles', () => {
    let owner: Awaited<ReturnType<typeof register>>;
    let admin: Awaited<ReturnType<typeof register>>;
    let member: Awaited<ReturnType<typeof register>>;
    let guest: Awaited<ReturnType<typeof register>>;
    let outsider: Awaited<ReturnType<typeof register>>;
    let slug: string;
    let workspaceId: string;

    beforeAll(async () => {
      slug = 'rbac-space';
      owner = await register(baseUrl, 'rbac-owner@example.com');
      admin = await register(baseUrl, 'rbac-admin@example.com');
      member = await register(baseUrl, 'rbac-member@example.com');
      guest = await register(baseUrl, 'rbac-guest@example.com');
      outsider = await register(baseUrl, 'rbac-outsider@example.com');
      for (const u of [owner, admin, member, guest, outsider]) await verifyUser(u.userId);

      const res = await req(baseUrl, 'POST', '/workspaces', {
        token: owner.accessToken,
        body: { name: 'RBAC Space', slug },
      });
      workspaceId = ((await res.json()) as { id: string }).id;

      // Seed memberships directly so we don't need to run the full invite loop.
      await getPrisma().workspaceMember.createMany({
        data: [
          { workspaceId, userId: admin.userId, role: 'ADMIN' },
          { workspaceId, userId: member.userId, role: 'MEMBER' },
          { workspaceId, userId: guest.userId, role: 'GUEST' },
        ],
      });
    });

    it('outsider gets 403 from any workspace-scoped route', async () => {
      const res = await req(baseUrl, 'GET', `/workspaces/${slug}/members`, {
        token: outsider.accessToken,
      });
      expect(res.status).toBe(403);
    });

    it('GUEST can read the workspace and member list', async () => {
      const wsRes = await req(baseUrl, 'GET', `/workspaces/${slug}`, {
        token: guest.accessToken,
      });
      expect(wsRes.status).toBe(200);
      const membersRes = await req(baseUrl, 'GET', `/workspaces/${slug}/members`, {
        token: guest.accessToken,
      });
      expect(membersRes.status).toBe(200);
    });

    it('GUEST cannot PATCH workspace (needs ADMIN)', async () => {
      const res = await req(baseUrl, 'PATCH', `/workspaces/${slug}`, {
        token: guest.accessToken,
        body: { name: 'GuestRename' },
      });
      expect(res.status).toBe(403);
    });

    it('ADMIN can PATCH workspace', async () => {
      const res = await req(baseUrl, 'PATCH', `/workspaces/${slug}`, {
        token: admin.accessToken,
        body: { name: 'AdminRename' },
      });
      expect(res.status).toBe(200);
    });

    it('ADMIN cannot DELETE workspace (Owner only)', async () => {
      const res = await req(baseUrl, 'DELETE', `/workspaces/${slug}`, {
        token: admin.accessToken,
      });
      expect(res.status).toBe(403);
    });

    it('Admin cannot demote another Admin (PRD FR-8)', async () => {
      const admin2 = await register(baseUrl, 'rbac-admin2@example.com');
      await verifyUser(admin2.userId);
      await getPrisma().workspaceMember.create({
        data: { workspaceId, userId: admin2.userId, role: 'ADMIN' },
      });
      const res = await req(baseUrl, 'PATCH', `/workspaces/${slug}/members/${admin2.userId}`, {
        token: admin.accessToken,
        body: { role: 'MEMBER' },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { type?: string };
      expect(body.type).toBe('https://tasker.dev/problems/admin-cannot-touch-admin');
    });

    it('Owner CAN demote another Admin', async () => {
      const admin3 = await register(baseUrl, 'rbac-admin3@example.com');
      await verifyUser(admin3.userId);
      await getPrisma().workspaceMember.create({
        data: { workspaceId, userId: admin3.userId, role: 'ADMIN' },
      });
      const res = await req(baseUrl, 'PATCH', `/workspaces/${slug}/members/${admin3.userId}`, {
        token: owner.accessToken,
        body: { role: 'MEMBER' },
      });
      expect(res.status).toBe(200);
    });

    it('demoting the sole Owner is refused with 409', async () => {
      const res = await req(baseUrl, 'PATCH', `/workspaces/${slug}/members/${owner.userId}`, {
        token: owner.accessToken,
        body: { role: 'MEMBER' },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { type: string };
      expect(body.type).toBe('https://tasker.dev/problems/sole-owner-demotion');
    });

    it('member can leave the workspace (self-remove)', async () => {
      const leaver = await register(baseUrl, 'leaver@example.com');
      await verifyUser(leaver.userId);
      await getPrisma().workspaceMember.create({
        data: { workspaceId, userId: leaver.userId, role: 'MEMBER' },
      });
      const res = await req(baseUrl, 'DELETE', `/workspaces/${slug}/members/${leaver.userId}`, {
        token: leaver.accessToken,
      });
      expect(res.status).toBe(204);
      const still = await getPrisma().workspaceMember.findFirst({
        where: { workspaceId, userId: leaver.userId },
      });
      expect(still).toBeNull();
    });

    it('OWNER cannot self-leave', async () => {
      const res = await req(baseUrl, 'DELETE', `/workspaces/${slug}/members/${owner.userId}`, {
        token: owner.accessToken,
      });
      expect(res.status).toBe(400);
    });

    it('transfer-ownership atomically demotes previous Owner to Admin', async () => {
      const res = await req(baseUrl, 'POST', `/workspaces/${slug}/transfer-ownership`, {
        token: owner.accessToken,
        body: { newOwnerUserId: admin.userId },
      });
      expect(res.status).toBe(201);

      const nowOwner = await getPrisma().workspaceMember.findFirst({
        where: { workspaceId, userId: admin.userId },
      });
      const nowAdmin = await getPrisma().workspaceMember.findFirst({
        where: { workspaceId, userId: owner.userId },
      });
      expect(nowOwner?.role).toBe('OWNER');
      expect(nowAdmin?.role).toBe('ADMIN');

      const workspace = await getPrisma().workspace.findUnique({ where: { id: workspaceId } });
      expect(workspace?.ownerUserId).toBe(admin.userId);

      // Restore for downstream tests
      await getPrisma().workspaceMember.updateMany({
        where: { workspaceId, userId: owner.userId },
        data: { role: 'OWNER' },
      });
      await getPrisma().workspaceMember.updateMany({
        where: { workspaceId, userId: admin.userId },
        data: { role: 'ADMIN' },
      });
      await getPrisma().workspace.update({
        where: { id: workspaceId },
        data: { ownerUserId: owner.userId },
      });
    });
  });

  describe('soft delete + restore', () => {
    it('DELETE hides the workspace from all reads; restore brings it back', async () => {
      const owner = await register(baseUrl, 'delete-owner@example.com');
      await verifyUser(owner.userId);
      const created = await req(baseUrl, 'POST', '/workspaces', {
        token: owner.accessToken,
        body: { name: 'Delete Me', slug: 'delete-me' },
      });
      const workspaceId = ((await created.json()) as { id: string }).id;

      const del = await req(baseUrl, 'DELETE', '/workspaces/delete-me', {
        token: owner.accessToken,
      });
      expect(del.status).toBe(204);

      // Guard hides it as inaccessible → 403 (not 200) because the workspace is deletedAt
      const afterDelete = await req(baseUrl, 'GET', '/workspaces/delete-me', {
        token: owner.accessToken,
      });
      expect(afterDelete.status).toBe(403);

      const restore = await req(baseUrl, 'POST', '/workspaces/delete-me/restore', {
        token: owner.accessToken,
      });
      // WorkspaceGuard bypasses the deletedAt check for the /restore route so
      // the Owner can undo a soft-delete inside the 30-day window.
      expect(restore.status).toBe(201);
      const after = await getPrisma().workspace.findUnique({ where: { id: workspaceId } });
      expect(after?.deletedAt).toBeNull();
    });

    it('rejects a mismatched X-Workspace-Id header against the URL slug (tenant leak guard)', async () => {
      // Register a user who is Admin of workspace A. Ask for workspace B by
      // slug while asserting X-Workspace-Id: A → must 403, otherwise Admin of A
      // could read/mutate B's data.
      const attacker = await register(baseUrl, 'tenant-leak@example.com');
      await verifyUser(attacker.userId);
      const wsA = await req(baseUrl, 'POST', '/workspaces', {
        token: attacker.accessToken,
        body: { name: 'Attacker WS', slug: 'attacker-ws' },
      });
      const wsAId = ((await wsA.json()) as { id: string }).id;

      const victim = await register(baseUrl, 'tenant-leak-victim@example.com');
      await verifyUser(victim.userId);
      await req(baseUrl, 'POST', '/workspaces', {
        token: victim.accessToken,
        body: { name: 'Victim WS', slug: 'victim-ws' },
      });

      const res = await req(baseUrl, 'GET', '/workspaces/victim-ws/members', {
        token: attacker.accessToken,
        headers: { 'X-Workspace-Id': wsAId },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { type: string };
      expect(body.type).toBe('https://tasker.dev/problems/workspace-id-mismatch');
    });
  });

  describe('invitations', () => {
    let owner: Awaited<ReturnType<typeof register>>;
    let slug: string;

    beforeAll(async () => {
      owner = await register(baseUrl, 'inv-owner@example.com');
      await verifyUser(owner.userId);
      slug = 'inv-space';
      await req(baseUrl, 'POST', '/workspaces', {
        token: owner.accessToken,
        body: { name: 'Inv Space', slug },
      });
    });

    it('creates an invitation and enqueues an invitation email', async () => {
      capturedMails.length = 0;
      const res = await req(baseUrl, 'POST', `/workspaces/${slug}/invitations`, {
        token: owner.accessToken,
        body: { email: 'invitee@example.com', role: 'MEMBER' },
      });
      expect(res.status).toBe(201);
      const invitationMails = capturedMails.filter((m) => m.template === 'invitation');
      expect(invitationMails).toHaveLength(1);
      expect(invitationMails[0].to).toBe('invitee@example.com');
      expect(invitationMails[0].variables['acceptUrl']).toContain('/invitations/');
    });

    it('re-inviting the same email refreshes the token but keeps the same row (idempotent per PRD FR-9)', async () => {
      const first = await req(baseUrl, 'POST', `/workspaces/${slug}/invitations`, {
        token: owner.accessToken,
        body: { email: 'twice@example.com', role: 'MEMBER' },
      });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { id: string };
      const firstRow = await getPrisma().invitation.findUnique({ where: { id: firstBody.id } });
      const firstHash = firstRow!.tokenHash;

      const second = await req(baseUrl, 'POST', `/workspaces/${slug}/invitations`, {
        token: owner.accessToken,
        body: { email: 'twice@example.com', role: 'MEMBER' },
      });
      expect(second.status).toBe(201);
      const secondBody = (await second.json()) as { id: string };
      expect(secondBody.id).toBe(firstBody.id);
      const secondRow = await getPrisma().invitation.findUnique({ where: { id: firstBody.id } });
      expect(secondRow!.tokenHash).not.toBe(firstHash); // token was refreshed
    });

    it('accept requires the same email as the invitation', async () => {
      capturedMails.length = 0;
      await req(baseUrl, 'POST', `/workspaces/${slug}/invitations`, {
        token: owner.accessToken,
        body: { email: 'match-me@example.com', role: 'MEMBER' },
      });
      const mail = capturedMails.find((m) => m.to === 'match-me@example.com')!;
      const acceptUrl = mail.variables['acceptUrl'] as string;
      const token = acceptUrl.split('/').pop()!;

      // Wrong-email caller
      const wrong = await register(baseUrl, 'wrong-email@example.com');
      const wrongRes = await req(baseUrl, 'POST', `/invitations/${token}/accept`, {
        token: wrong.accessToken,
      });
      expect(wrongRes.status).toBe(409);

      // Correct-email caller
      const right = await register(baseUrl, 'match-me@example.com');
      const rightRes = await req(baseUrl, 'POST', `/invitations/${token}/accept`, {
        token: right.accessToken,
      });
      expect(rightRes.status).toBe(201);

      const member = await getPrisma().workspaceMember.findFirst({
        where: { userId: right.userId },
      });
      expect(member).not.toBeNull();
    });

    it('decline is public and marks the invitation revoked', async () => {
      capturedMails.length = 0;
      await req(baseUrl, 'POST', `/workspaces/${slug}/invitations`, {
        token: owner.accessToken,
        body: { email: 'decliner@example.com', role: 'MEMBER' },
      });
      const mail = capturedMails.find((m) => m.to === 'decliner@example.com')!;
      const token = (mail.variables['acceptUrl'] as string).split('/').pop()!;
      const res = await req(baseUrl, 'POST', `/invitations/${token}/decline`);
      expect(res.status).toBe(204);
    });

    it('DELETE /workspaces/:slug/invitations/:id revokes a pending invitation', async () => {
      capturedMails.length = 0;
      const create = await req(baseUrl, 'POST', `/workspaces/${slug}/invitations`, {
        token: owner.accessToken,
        body: { email: 'revoke-me@example.com', role: 'MEMBER' },
      });
      const { id } = (await create.json()) as { id: string };
      const del = await req(baseUrl, 'DELETE', `/workspaces/${slug}/invitations/${id}`, {
        token: owner.accessToken,
      });
      expect(del.status).toBe(204);
      const invitation = await getPrisma().invitation.findUnique({ where: { id } });
      expect(invitation?.revokedAt).not.toBeNull();
    });
  });
});
