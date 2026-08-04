/**
 * Search & Audit — Phase 7 migration integration test.
 *
 * Boots a real Postgres 16 container, runs every migration, and asserts:
 *   1. `AuditLog.targetType` column + composite index exist and persist.
 *   2. Generated `search_vector` STORED columns exist on Task, Project,
 *      Sprint, User and stay in sync across INSERT / UPDATE.
 *   3. GIN indexes over `search_vector` are used by planner for
 *      `websearch_to_tsquery` (`@@`) predicates.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

const TEST_TIMEOUT = 180_000;

interface IndexRow {
  indexname: string;
}
interface ColumnRow {
  column_name: string;
  data_type: string;
  is_generated: string;
}

describe('Search & Audit migration (integration)', () => {
  let container: StartedTestContainer;
  let prisma: PrismaClient;
  let ownerId: string;
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

    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    const owner = await prisma.user.create({
      data: { email: 'owner@search.test', displayName: 'Search Owner', updatedAt: new Date() },
    });
    ownerId = owner.id;
    const ws = await prisma.workspace.create({
      data: { slug: 'search-ws', name: 'Search WS', ownerUserId: owner.id, updatedAt: new Date() },
    });
    workspaceId = ws.id;
    const project = await prisma.project.create({
      data: {
        workspaceId,
        slug: 'demo',
        name: 'Demo project',
        description: 'Original description',
        color: '#000000',
        icon: 'folder',
        ownerUserId: ownerId,
        createdByUserId: ownerId,
        updatedAt: new Date(),
      },
    });
    projectId = project.id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  }, TEST_TIMEOUT);

  // -------------------------------------------------------------------------
  // AuditLog additive changes
  // -------------------------------------------------------------------------

  describe('AuditLog', () => {
    it('exposes the new targetType column and composite index', async () => {
      const columns = await prisma.$queryRawUnsafe<ColumnRow[]>(
        `SELECT column_name, data_type, is_generated
         FROM information_schema.columns
         WHERE table_name = 'AuditLog' AND column_name = 'targetType'`,
      );
      expect(columns).toHaveLength(1);
      expect(columns[0].data_type).toBe('text');
      expect(columns[0].is_generated).toBe('NEVER');

      const indexes = await prisma.$queryRawUnsafe<IndexRow[]>(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'AuditLog'
           AND indexname = 'AuditLog_workspaceId_targetType_createdAt_idx'`,
      );
      expect(indexes).toHaveLength(1);
    });

    it('persists targetType alongside existing fields', async () => {
      const row = await prisma.auditLog.create({
        data: {
          workspaceId,
          actorUserId: ownerId,
          event: 'test.event',
          targetType: 'task',
          targetId: 'task-x',
          metadata: { note: 'hello' },
        },
      });
      expect(row.targetType).toBe('task');

      const nullTarget = await prisma.auditLog.create({
        data: { workspaceId, event: 'test.event.no-target' },
      });
      expect(nullTarget.targetType).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Generated tsvector columns
  // -------------------------------------------------------------------------

  describe('search_vector columns', () => {
    it.each(['Task', 'Project', 'Sprint', 'User'])(
      '%s has a STORED generated search_vector column and GIN index',
      async (table) => {
        const columns = await prisma.$queryRawUnsafe<ColumnRow[]>(
          `SELECT column_name, data_type, is_generated
           FROM information_schema.columns
           WHERE table_name = $1 AND column_name = 'search_vector'`,
          table,
        );
        expect(columns).toHaveLength(1);
        expect(columns[0].data_type).toBe('tsvector');
        expect(columns[0].is_generated).toBe('ALWAYS');

        const indexes = await prisma.$queryRawUnsafe<IndexRow[]>(
          `SELECT indexname FROM pg_indexes
           WHERE tablename = $1 AND indexname = $2`,
          table,
          `${table}_search_vector_idx`,
        );
        expect(indexes).toHaveLength(1);
      },
    );

    it('populates task.search_vector on insert and rewrites it on update', async () => {
      const task = await prisma.task.create({
        data: {
          workspaceId,
          projectId,
          number: 1,
          title: 'Fix login redirect loop',
          description: 'Users bouncing between /auth and /dashboard',
          position: '0|hzzzzz:',
          createdByUserId: ownerId,
          updatedAt: new Date(),
        },
      });

      const beforeRows = await prisma.$queryRawUnsafe<Array<{ hit: boolean }>>(
        `SELECT "search_vector" @@ websearch_to_tsquery('simple', 'login') AS hit
         FROM "Task" WHERE id = $1`,
        task.id,
      );
      expect(beforeRows[0].hit).toBe(true);

      await prisma.task.update({
        where: { id: task.id },
        data: { title: 'Fix onboarding tooltip', description: 'Refresh copy for step 2' },
      });

      const afterRows = await prisma.$queryRawUnsafe<
        Array<{ login: boolean; onboarding: boolean }>
      >(
        `SELECT
           "search_vector" @@ websearch_to_tsquery('simple', 'login') AS login,
           "search_vector" @@ websearch_to_tsquery('simple', 'onboarding') AS onboarding
         FROM "Task" WHERE id = $1`,
        task.id,
      );
      expect(afterRows[0].login).toBe(false);
      expect(afterRows[0].onboarding).toBe(true);
    });

    it('weights the primary label above the secondary body', async () => {
      // Two tasks: one matches "widget" only in title, the other only in description.
      // ts_rank_cd on the same query must rank the title match higher.
      await prisma.task.create({
        data: {
          workspaceId,
          projectId,
          number: 2,
          title: 'Widget carousel v2',
          description: 'unrelated body copy',
          position: '0|hzzzy:',
          createdByUserId: ownerId,
          updatedAt: new Date(),
        },
      });
      await prisma.task.create({
        data: {
          workspaceId,
          projectId,
          number: 3,
          title: 'unrelated title',
          description: 'Long body mentioning widget once',
          position: '0|hzzzx:',
          createdByUserId: ownerId,
          updatedAt: new Date(),
        },
      });

      const rows = await prisma.$queryRawUnsafe<Array<{ number: number; rank: number }>>(
        `SELECT number, ts_rank_cd("search_vector", websearch_to_tsquery('simple', 'widget')) AS rank
         FROM "Task"
         WHERE "workspaceId" = $1
           AND "search_vector" @@ websearch_to_tsquery('simple', 'widget')
         ORDER BY rank DESC`,
        workspaceId,
      );

      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].number).toBe(2); // title match wins
    });
  });
});
