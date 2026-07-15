/**
 * Tenant isolation integration test suite.
 *
 * Boots a real Postgres 16 container via Testcontainers, applies all
 * migrations, seeds two workspaces (W1 + W2) with one member each, and
 * asserts that every Prisma operation through forTenant() is scoped to the
 * active workspace context.
 *
 * Requires Docker to be available in the test environment.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { WorkspaceContextStore, WorkspaceContext } from '../src/common/context/workspace-context.store';
import { buildTenantExtension } from '../src/prisma/tenant.extension';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_TIMEOUT = 120_000;

function makeTenantClient(raw: PrismaClient, store: WorkspaceContextStore) {
  return raw.$extends(buildTenantExtension(store));
}

async function seedBaseline(raw: PrismaClient) {
  const userA = await raw.user.create({
    data: { id: 'user-a', email: 'a@w1.test', displayName: 'User A', updatedAt: new Date() },
  });
  const userB = await raw.user.create({
    data: { id: 'user-b', email: 'b@w2.test', displayName: 'User B', updatedAt: new Date() },
  });

  const ws1 = await raw.workspace.create({
    data: { id: 'ws-1', slug: 'workspace-one', name: 'Workspace One', ownerUserId: userA.id, updatedAt: new Date() },
  });
  const ws2 = await raw.workspace.create({
    data: { id: 'ws-2', slug: 'workspace-two', name: 'Workspace Two', ownerUserId: userB.id, updatedAt: new Date() },
  });

  const memA = await raw.workspaceMember.create({
    data: { id: 'mem-a', workspaceId: ws1.id, userId: userA.id, role: 'OWNER', updatedAt: new Date() },
  });
  const memB = await raw.workspaceMember.create({
    data: { id: 'mem-b', workspaceId: ws2.id, userId: userB.id, role: 'OWNER', updatedAt: new Date() },
  });

  await raw.invitation.create({
    data: {
      id: 'inv-a',
      workspaceId: ws1.id,
      email: 'invite@w1.test',
      role: 'MEMBER',
      tokenHash: 'hash-a',
      invitedByUserId: userA.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: new Date(),
    },
  });
  await raw.invitation.create({
    data: {
      id: 'inv-b',
      workspaceId: ws2.id,
      email: 'invite@w2.test',
      role: 'MEMBER',
      tokenHash: 'hash-b',
      invitedByUserId: userB.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: new Date(),
    },
  });

  return {
    userA, userB, ws1, ws2, memA, memB,
    ctxA: { userId: userA.id, workspaceId: ws1.id, role: 'OWNER' as const, membershipId: memA.id },
    ctxB: { userId: userB.id, workspaceId: ws2.id, role: 'OWNER' as const, membershipId: memB.id },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Tenant isolation (integration)', () => {
  let container: StartedTestContainer;
  let raw: PrismaClient;
  let store: WorkspaceContextStore;
  let seed: Awaited<ReturnType<typeof seedBaseline>>;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'tasker_test',
        POSTGRES_USER: 'tasker',
        POSTGRES_PASSWORD: 'tasker',
      })
      .withExposedPorts(5432)
      // Wait for the port to be open AND for the ready-log line (twice — once
      // for template DB, once for the main DB).
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(5432);
    const url = `postgresql://tasker:tasker@${host}:${port}/tasker_test`;
    process.env['DATABASE_URL'] = url;

    raw = new PrismaClient({ datasources: { db: { url } } });
    await raw.$connect();

    // Apply migrations
    execSync('pnpm prisma migrate deploy', {
      cwd: '/home/davi/tasker/backend',
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    store = new WorkspaceContextStore();
    seed = await seedBaseline(raw);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await raw?.$disconnect();
    await container?.stop();
  }, TEST_TIMEOUT);

  // -------------------------------------------------------------------------
  // WorkspaceMember isolation
  // -------------------------------------------------------------------------

  describe('WorkspaceMember', () => {
    it('findMany returns only W1 members when context is W1', async () => {
      const tenant = makeTenantClient(raw, store);
      await store.run(seed.ctxA, async () => {
        const members = await tenant.workspaceMember.findMany();
        expect(members).toHaveLength(1);
        expect(members[0].workspaceId).toBe(seed.ws1.id);
      });
    });

    it('findMany returns only W2 members when context is W2', async () => {
      const tenant = makeTenantClient(raw, store);
      await store.run(seed.ctxB, async () => {
        const members = await tenant.workspaceMember.findMany();
        expect(members).toHaveLength(1);
        expect(members[0].workspaceId).toBe(seed.ws2.id);
      });
    });

    it('count reflects only the active workspace', async () => {
      const tenant = makeTenantClient(raw, store);
      await store.run(seed.ctxA, async () => {
        expect(await tenant.workspaceMember.count()).toBe(1);
      });
    });

    it('spoofing workspaceId in where is overridden by injected value', async () => {
      const tenant = makeTenantClient(raw, store);
      await store.run(seed.ctxA, async () => {
        // Attempt to read W2's members from W1's context
        const members = await tenant.workspaceMember.findMany({
          where: { workspaceId: seed.ws2.id },
        });
        expect(members).toHaveLength(1);
        expect(members[0].workspaceId).toBe(seed.ws1.id);
      });
    });

    it('create injects workspaceId automatically', async () => {
      const tenant = makeTenantClient(raw, store);
      await store.run(seed.ctxA, async () => {
        const extraUser = await raw.user.create({
          data: { email: 'extra@w1.test', displayName: 'Extra', updatedAt: new Date() },
        });
        const member = await tenant.workspaceMember.create({
          data: { userId: extraUser.id, role: 'MEMBER', updatedAt: new Date() } as never,
        });
        expect(member.workspaceId).toBe(seed.ws1.id);

        // Cleanup
        await raw.workspaceMember.delete({ where: { id: member.id } });
        await raw.user.delete({ where: { id: extraUser.id } });
      });
    });

    it('create with spoofed workspaceId still lands in W1', async () => {
      const tenant = makeTenantClient(raw, store);
      await store.run(seed.ctxA, async () => {
        const extraUser = await raw.user.create({
          data: { email: 'spoof@test.com', displayName: 'Spoof', updatedAt: new Date() },
        });
        const member = await tenant.workspaceMember.create({
          data: { workspaceId: seed.ws2.id, userId: extraUser.id, role: 'MEMBER', updatedAt: new Date() } as never,
        });
        expect(member.workspaceId).toBe(seed.ws1.id);

        // Cleanup
        await raw.workspaceMember.delete({ where: { id: member.id } });
        await raw.user.delete({ where: { id: extraUser.id } });
      });
    });

    it('createMany injects workspaceId into every row', async () => {
      const tenant = makeTenantClient(raw, store);
      const [u1, u2] = await Promise.all([
        raw.user.create({ data: { email: 'bulk1@w1.test', displayName: 'Bulk1', updatedAt: new Date() } }),
        raw.user.create({ data: { email: 'bulk2@w1.test', displayName: 'Bulk2', updatedAt: new Date() } }),
      ]);

      await store.run(seed.ctxA, async () => {
        await tenant.workspaceMember.createMany({
          data: [
            { userId: u1.id, role: 'MEMBER', updatedAt: new Date() },
            { userId: u2.id, role: 'GUEST', updatedAt: new Date() },
          ] as never,
        });
      });

      const created = await raw.workspaceMember.findMany({
        where: { userId: { in: [u1.id, u2.id] } },
      });
      expect(created).toHaveLength(2);
      expect(created.every(m => m.workspaceId === seed.ws1.id)).toBe(true);

      // Cleanup
      await raw.workspaceMember.deleteMany({ where: { userId: { in: [u1.id, u2.id] } } });
      await raw.user.deleteMany({ where: { id: { in: [u1.id, u2.id] } } });
    });

    it('deleteMany in W1 context does not touch W2 rows', async () => {
      const tenant = makeTenantClient(raw, store);
      const extraUser = await raw.user.create({
        data: { email: 'del@w1.test', displayName: 'Del', updatedAt: new Date() },
      });
      await raw.workspaceMember.create({
        data: { workspaceId: seed.ws1.id, userId: extraUser.id, role: 'MEMBER', updatedAt: new Date() },
      });

      await store.run(seed.ctxA, async () => {
        await tenant.workspaceMember.deleteMany({ where: { userId: extraUser.id } });
      });

      // W2's member should be untouched
      const remaining = await raw.workspaceMember.count({ where: { workspaceId: seed.ws2.id } });
      expect(remaining).toBe(1);

      await raw.user.delete({ where: { id: extraUser.id } });
    });
  });

  // -------------------------------------------------------------------------
  // Invitation isolation
  // -------------------------------------------------------------------------

  describe('Invitation', () => {
    it('findMany returns only W1 invitations in W1 context', async () => {
      const tenant = makeTenantClient(raw, store);
      await store.run(seed.ctxA, async () => {
        const invitations = await tenant.invitation.findMany();
        expect(invitations).toHaveLength(1);
        expect(invitations[0].id).toBe('inv-a');
      });
    });

    it('findMany returns only W2 invitations in W2 context', async () => {
      const tenant = makeTenantClient(raw, store);
      await store.run(seed.ctxB, async () => {
        const invitations = await tenant.invitation.findMany();
        expect(invitations).toHaveLength(1);
        expect(invitations[0].id).toBe('inv-b');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Non-tenant models are untouched
  // -------------------------------------------------------------------------

  describe('Non-tenant models', () => {
    it('User.findMany is not filtered by workspaceId', async () => {
      const tenant = makeTenantClient(raw, store);
      await store.run(seed.ctxA, async () => {
        const users = await tenant.user.findMany();
        // Both users are visible — User is not tenant-scoped
        expect(users.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Calling forTenant without a context throws for tenant models
  // -------------------------------------------------------------------------

  describe('Missing context', () => {
    it('throws when querying a tenant model outside a run()', async () => {
      const tenant = makeTenantClient(raw, store);
      // store has no active context here
      await expect(tenant.workspaceMember.findMany()).rejects.toThrow();
    });
  });
});
