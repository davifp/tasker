/**
 * Phase-3 smoke: the DMMF-driven tenant extension auto-covers the new
 * tenant-scoped models. Creates a Project and a Task through forTenant()
 * without supplying workspaceId and asserts it is injected on both writes.
 *
 * Requires Docker to be available (Testcontainers boots Postgres 16).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { WorkspaceContextStore } from '../src/common/context/workspace-context.store';
import { buildTenantExtension } from '../src/prisma/tenant.extension';
import { Positions } from '../src/common/ordering/positions';

const TEST_TIMEOUT = 120_000;

function makeTenantClient(raw: PrismaClient, store: WorkspaceContextStore) {
  return raw.$extends(buildTenantExtension(store));
}

describe('Tenant auto-injection for Phase-3 models (integration)', () => {
  let container: StartedTestContainer;
  let raw: PrismaClient;
  let store: WorkspaceContextStore;
  let ctx: { userId: string; workspaceId: string; role: 'OWNER'; membershipId: string };
  let userId: string;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'tasker_test',
        POSTGRES_USER: 'tasker',
        POSTGRES_PASSWORD: 'tasker',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(5432);
    const url = `postgresql://tasker:tasker@${host}:${port}/tasker_test`;
    process.env['DATABASE_URL'] = url;

    raw = new PrismaClient({ datasources: { db: { url } } });
    await raw.$connect();

    execSync('pnpm prisma migrate deploy', {
      cwd: '/home/davi/tasker/backend',
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    store = new WorkspaceContextStore();

    const user = await raw.user.create({
      data: { email: 'owner@t.test', displayName: 'Owner', updatedAt: new Date() },
    });
    userId = user.id;

    const workspace = await raw.workspace.create({
      data: {
        slug: 'ws-p3',
        name: 'Phase 3',
        ownerUserId: user.id,
        updatedAt: new Date(),
      },
    });
    workspaceId = workspace.id;

    const membership = await raw.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
        updatedAt: new Date(),
      },
    });

    ctx = { userId, workspaceId, role: 'OWNER', membershipId: membership.id };
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await raw?.$disconnect();
    await container?.stop();
  }, TEST_TIMEOUT);

  it('injects workspaceId into a Project.create without it in data', async () => {
    const tenant = makeTenantClient(raw, store);

    const project = await store.run(ctx, async () => {
      return tenant.project.create({
        data: {
          slug: 'web',
          name: 'Web',
          color: '#3b82f6',
          icon: 'Package',
          ownerUserId: userId,
          createdByUserId: userId,
          updatedAt: new Date(),
        } as never,
      });
    });

    expect(project.workspaceId).toBe(workspaceId);
    projectId = project.id;
  });

  it('injects workspaceId into a Task.create without it in data', async () => {
    const tenant = makeTenantClient(raw, store);

    const task = await store.run(ctx, async () => {
      return tenant.task.create({
        data: {
          projectId,
          number: 1,
          title: 'First task',
          position: Positions.between(null, null),
          createdByUserId: userId,
          updatedAt: new Date(),
        } as never,
      });
    });

    expect(task.workspaceId).toBe(workspaceId);
  });

  it('injects workspaceId into a Comment.create without it in data', async () => {
    const tenant = makeTenantClient(raw, store);

    const task = await raw.task.create({
      data: {
        workspaceId,
        projectId,
        number: 2,
        title: 'Second task',
        position: Positions.between(null, null),
        createdByUserId: userId,
        updatedAt: new Date(),
      },
    });

    const comment = await store.run(ctx, async () => {
      return tenant.comment.create({
        data: {
          taskId: task.id,
          authorUserId: userId,
          body: 'Auto-injected workspaceId',
          updatedAt: new Date(),
        } as never,
      });
    });

    expect(comment.workspaceId).toBe(workspaceId);
  });

  it('injects workspaceId into a Label.create without it in data', async () => {
    const tenant = makeTenantClient(raw, store);

    const label = await store.run(ctx, async () => {
      return tenant.label.create({
        data: {
          name: 'bug',
          color: '#ef4444',
        } as never,
      });
    });

    expect(label.workspaceId).toBe(workspaceId);
  });
});
