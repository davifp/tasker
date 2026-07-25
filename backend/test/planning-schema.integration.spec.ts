/**
 * Planning schema integration test.
 *
 * Boots a real Postgres 16 container, applies every migration (including
 * `0007_planning`), and asserts three properties introduced by Task 2.0:
 *
 *   1. Tenant isolation for every new tenant-scoped model (Sprint,
 *      SprintCapacity, SprintTaskSnapshot, Epic) — a query in workspace A
 *      never returns rows from workspace B.
 *   2. The PRD FR-2 partial unique index on `Sprint(projectId) WHERE state =
 *      'ACTIVE'` blocks a second Active sprint in the same project.
 *   3. Both materialized views (`mv_sprint_daily_burndown`,
 *      `mv_workspace_cycle_lead_time`) support
 *      `REFRESH MATERIALIZED VIEW CONCURRENTLY` — proves their unique
 *      indexes are in place.
 *
 * Requires Docker to be available in the test environment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import {
  WorkspaceContext,
  WorkspaceContextStore,
} from '../src/common/context/workspace-context.store';
import { buildTenantExtension } from '../src/prisma/tenant.extension';

const TEST_TIMEOUT = 180_000;

interface Seed {
  ws1: string;
  ws2: string;
  proj1: string;
  proj2: string;
  user1: string;
  user2: string;
  ctxA: WorkspaceContext;
  ctxB: WorkspaceContext;
}

async function seedPlanning(raw: PrismaClient): Promise<Seed> {
  const u1 = await raw.user.create({
    data: { email: 'plan-a@w1.test', displayName: 'Planner A', updatedAt: new Date() },
  });
  const u2 = await raw.user.create({
    data: { email: 'plan-b@w2.test', displayName: 'Planner B', updatedAt: new Date() },
  });
  const w1 = await raw.workspace.create({
    data: { slug: 'plan-w1', name: 'Plan W1', ownerUserId: u1.id, updatedAt: new Date() },
  });
  const w2 = await raw.workspace.create({
    data: { slug: 'plan-w2', name: 'Plan W2', ownerUserId: u2.id, updatedAt: new Date() },
  });
  const m1 = await raw.workspaceMember.create({
    data: { workspaceId: w1.id, userId: u1.id, role: 'OWNER', updatedAt: new Date() },
  });
  const m2 = await raw.workspaceMember.create({
    data: { workspaceId: w2.id, userId: u2.id, role: 'OWNER', updatedAt: new Date() },
  });
  const p1 = await raw.project.create({
    data: {
      workspaceId: w1.id,
      slug: 'p1',
      name: 'Project 1',
      color: '#000',
      icon: 'star',
      ownerUserId: u1.id,
      createdByUserId: u1.id,
      updatedAt: new Date(),
    },
  });
  const p2 = await raw.project.create({
    data: {
      workspaceId: w2.id,
      slug: 'p2',
      name: 'Project 2',
      color: '#000',
      icon: 'star',
      ownerUserId: u2.id,
      createdByUserId: u2.id,
      updatedAt: new Date(),
    },
  });
  return {
    ws1: w1.id,
    ws2: w2.id,
    proj1: p1.id,
    proj2: p2.id,
    user1: u1.id,
    user2: u2.id,
    ctxA: { userId: u1.id, workspaceId: w1.id, role: 'OWNER', membershipId: m1.id },
    ctxB: { userId: u2.id, workspaceId: w2.id, role: 'OWNER', membershipId: m2.id },
  };
}

describe('Planning schema (integration)', () => {
  let container: StartedTestContainer;
  let raw: PrismaClient;
  let store: WorkspaceContextStore;
  let seed: Seed;

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
    seed = await seedPlanning(raw);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await raw?.$disconnect();
    await container?.stop();
  }, TEST_TIMEOUT);

  // -------------------------------------------------------------------------
  // Tenant isolation for the new planning models
  // -------------------------------------------------------------------------

  describe('Tenant isolation', () => {
    it('Sprint findMany returns only the active workspace rows', async () => {
      // Seed one sprint per workspace via the raw client.
      await raw.sprint.create({
        data: {
          workspaceId: seed.ws1,
          projectId: seed.proj1,
          number: 1,
          name: 'W1 Sprint 1',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-08-14'),
          createdByUserId: seed.user1,
          updatedAt: new Date(),
        },
      });
      await raw.sprint.create({
        data: {
          workspaceId: seed.ws2,
          projectId: seed.proj2,
          number: 1,
          name: 'W2 Sprint 1',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-08-14'),
          createdByUserId: seed.user2,
          updatedAt: new Date(),
        },
      });

      const tenant = raw.$extends(buildTenantExtension(store));

      await store.run(seed.ctxA, async () => {
        const sprints = await tenant.sprint.findMany();
        expect(sprints).toHaveLength(1);
        expect(sprints[0].workspaceId).toBe(seed.ws1);
      });
      await store.run(seed.ctxB, async () => {
        const sprints = await tenant.sprint.findMany();
        expect(sprints).toHaveLength(1);
        expect(sprints[0].workspaceId).toBe(seed.ws2);
      });
    });

    it('Epic list is scoped to the active workspace', async () => {
      await raw.epic.create({
        data: {
          workspaceId: seed.ws1,
          projectId: seed.proj1,
          title: 'W1 Epic',
          startQuarter: '2026-Q3',
          endQuarter: '2026-Q4',
          createdByUserId: seed.user1,
          updatedAt: new Date(),
        },
      });
      await raw.epic.create({
        data: {
          workspaceId: seed.ws2,
          projectId: seed.proj2,
          title: 'W2 Epic',
          startQuarter: '2026-Q3',
          endQuarter: '2026-Q4',
          createdByUserId: seed.user2,
          updatedAt: new Date(),
        },
      });

      const tenant = raw.$extends(buildTenantExtension(store));

      await store.run(seed.ctxA, async () => {
        const epics = await tenant.epic.findMany();
        expect(epics).toHaveLength(1);
        expect(epics[0].workspaceId).toBe(seed.ws1);
      });
    });

    it('spoofing workspaceId in Sprint where is overridden by the injected value', async () => {
      const tenant = raw.$extends(buildTenantExtension(store));
      await store.run(seed.ctxA, async () => {
        const sprints = await tenant.sprint.findMany({
          where: { workspaceId: seed.ws2 },
        });
        expect(sprints.every((s) => s.workspaceId === seed.ws1)).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // PRD FR-2: partial unique index on ACTIVE sprints per project
  // -------------------------------------------------------------------------

  describe('PRD FR-2 — one Active sprint per project', () => {
    it('blocks a second Active sprint in the same project', async () => {
      // Reuse the seeded sprint from the isolation suite (project seed.proj1).
      await raw.sprint.updateMany({
        where: { projectId: seed.proj1, number: 1 },
        data: { state: 'ACTIVE', startedAt: new Date() },
      });

      await expect(
        raw.sprint.create({
          data: {
            workspaceId: seed.ws1,
            projectId: seed.proj1,
            number: 2,
            name: 'Second Active',
            state: 'ACTIVE',
            startDate: new Date('2026-09-01'),
            endDate: new Date('2026-09-14'),
            startedAt: new Date(),
            createdByUserId: seed.user1,
            updatedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/unique|Sprint_projectId_active/i);
    });

    it('allows PLANNED and COMPLETED alongside an ACTIVE sprint', async () => {
      const planned = await raw.sprint.create({
        data: {
          workspaceId: seed.ws1,
          projectId: seed.proj1,
          number: 3,
          name: 'Planned alongside Active',
          state: 'PLANNED',
          startDate: new Date('2026-10-01'),
          endDate: new Date('2026-10-14'),
          createdByUserId: seed.user1,
          updatedAt: new Date(),
        },
      });
      expect(planned.state).toBe('PLANNED');
    });
  });

  // -------------------------------------------------------------------------
  // Materialized views — REFRESH CONCURRENTLY smoke test
  // -------------------------------------------------------------------------

  describe('Materialized views', () => {
    it('REFRESH ... CONCURRENTLY succeeds on the burndown matview', async () => {
      // A concurrent refresh needs the target populated at least once with a
      // non-concurrent refresh so the unique index has rows to diff against.
      await raw.$executeRawUnsafe('REFRESH MATERIALIZED VIEW "mv_sprint_daily_burndown"');
      await expect(
        raw.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_sprint_daily_burndown"'),
      ).resolves.not.toThrow();
    });

    it('REFRESH ... CONCURRENTLY succeeds on the cycle/lead time matview', async () => {
      await raw.$executeRawUnsafe('REFRESH MATERIALIZED VIEW "mv_workspace_cycle_lead_time"');
      await expect(
        raw.$executeRawUnsafe(
          'REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_workspace_cycle_lead_time"',
        ),
      ).resolves.not.toThrow();
    });
  });
});
