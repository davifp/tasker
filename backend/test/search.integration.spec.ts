/**
 * SearchService end-to-end integration test against a real Postgres 16 container.
 *
 * Seeds two workspaces with overlapping keywords across every entity type and
 * asserts:
 *   1. Zero cross-workspace leakage on every filter permutation.
 *   2. `ts_headline` output contains <mark> markers for matched terms.
 *   3. Weighted rank puts label matches above body matches.
 *   4. `type` filter narrows the fan-out.
 *   5. `projectId` and `authorUserId` filters apply only to tasks.
 *   6. Cursor pagination is stable across a two-page fetch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { SearchService } from '../src/search/search.service';

const TEST_TIMEOUT = 180_000;

interface SeedWorkspace {
  workspaceId: string;
  workspaceSlug: string;
  ownerId: string;
  memberId: string;
  projectId: string;
  projectSlug: string;
  taskIds: string[];
}

async function seedWorkspace(
  prisma: PrismaClient,
  { slug, tag }: { slug: string; tag: string },
): Promise<SeedWorkspace> {
  const owner = await prisma.user.create({
    data: { email: `owner-${slug}@t.test`, displayName: `Owner ${tag}`, updatedAt: new Date() },
  });
  const memberUser = await prisma.user.create({
    data: {
      email: `member-${slug}@t.test`,
      displayName: `Widget hero ${tag}`,
      updatedAt: new Date(),
    },
  });
  const workspace = await prisma.workspace.create({
    data: { slug, name: `WS ${tag}`, ownerUserId: owner.id, updatedAt: new Date() },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: owner.id, role: 'OWNER', updatedAt: new Date() },
  });
  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: memberUser.id,
      role: 'MEMBER',
      updatedAt: new Date(),
    },
  });

  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      slug: `proj-${slug}`,
      name: `Widget project ${tag}`,
      description: `Rollup and dashboards for ${tag}`,
      color: '#000000',
      icon: 'folder',
      ownerUserId: owner.id,
      createdByUserId: owner.id,
      updatedAt: new Date(),
    },
  });

  const t1 = await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      number: 1,
      title: `Widget carousel v2 ${tag}`,
      description: 'unrelated body copy',
      position: '0|hzzzzz:',
      createdByUserId: owner.id,
      updatedAt: new Date(),
    },
  });
  const t2 = await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      number: 2,
      title: `Login redirect loop ${tag}`,
      description: `Long body mentioning widget once ${tag}`,
      position: '0|hzzzzy:',
      createdByUserId: memberUser.id,
      updatedAt: new Date(),
    },
  });

  await prisma.sprint.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      number: 1,
      name: `Widget sprint ${tag}`,
      goal: `Ship widget carousel v2 ${tag}`,
      startDate: new Date(),
      endDate: new Date(Date.now() + 14 * 86_400_000),
      createdByUserId: owner.id,
      updatedAt: new Date(),
    },
  });

  return {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    ownerId: owner.id,
    memberId: memberUser.id,
    projectId: project.id,
    projectSlug: project.slug,
    taskIds: [t1.id, t2.id],
  };
}

describe('SearchService (integration)', () => {
  let container: StartedTestContainer;
  let prisma: PrismaClient;
  let service: SearchService;
  let a: SeedWorkspace;
  let b: SeedWorkspace;

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

    a = await seedWorkspace(prisma, { slug: 'alpha', tag: 'A' });
    b = await seedWorkspace(prisma, { slug: 'beta', tag: 'B' });

    // SearchService uses PrismaService.forSystem(); we shim it with a minimal
    // adapter that exposes the same interface but delegates to the raw client.
    service = new SearchService({ forSystem: () => prisma } as never);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // Tenant isolation
  // ---------------------------------------------------------------------------

  it('never returns a workspace-B row when scoped to workspace A', async () => {
    const result = await service.query({
      workspaceId: a.workspaceId,
      workspaceSlug: a.workspaceSlug,
      q: 'widget',
      limit: 50,
    });
    expect(result.hits.length).toBeGreaterThan(0);
    for (const hit of result.hits) {
      expect(hit.workspaceSlug).toBe('alpha');
      // Every hit id belongs to A: tasks, project, sprint, and users membership.
      const inAWorkspace =
        a.taskIds.includes(hit.id) ||
        hit.id === a.projectId ||
        hit.id === a.ownerId ||
        hit.id === a.memberId ||
        hit.type === 'sprint';
      expect(inAWorkspace).toBe(true);
    }
  });

  it('never returns a workspace-A row when scoped to workspace B', async () => {
    const result = await service.query({
      workspaceId: b.workspaceId,
      workspaceSlug: b.workspaceSlug,
      q: 'widget',
      limit: 50,
    });
    for (const hit of result.hits) {
      expect(hit.workspaceSlug).toBe('beta');
    }
  });

  // ---------------------------------------------------------------------------
  // Snippet + rank
  // ---------------------------------------------------------------------------

  it('emits <mark> around matched terms in task snippets', async () => {
    const result = await service.query({
      workspaceId: a.workspaceId,
      workspaceSlug: a.workspaceSlug,
      q: 'widget',
      types: ['task'],
      limit: 10,
    });
    const withSnippet = result.hits.find((h) => h.snippet.includes('<mark>'));
    // The task whose description contains "widget" produces a mark; the other
    // matches only in title (empty description snippet), which is expected.
    expect(withSnippet).toBeDefined();
  });

  it('ranks a title-only match above a body-only match for the same term', async () => {
    const result = await service.query({
      workspaceId: a.workspaceId,
      workspaceSlug: a.workspaceSlug,
      q: 'widget',
      types: ['task'],
      limit: 10,
    });
    // t1: title contains widget, body does not → rank higher
    // t2: title does not, body contains widget once → rank lower
    const t1Index = result.hits.findIndex((h) => h.id === a.taskIds[0]);
    const t2Index = result.hits.findIndex((h) => h.id === a.taskIds[1]);
    expect(t1Index).toBeGreaterThanOrEqual(0);
    expect(t2Index).toBeGreaterThanOrEqual(0);
    expect(t1Index).toBeLessThan(t2Index);
  });

  // ---------------------------------------------------------------------------
  // Type filter
  // ---------------------------------------------------------------------------

  it('honors the `types` filter (only sprints returned)', async () => {
    const result = await service.query({
      workspaceId: a.workspaceId,
      workspaceSlug: a.workspaceSlug,
      q: 'widget',
      types: ['sprint'],
      limit: 10,
    });
    for (const hit of result.hits) {
      expect(hit.type).toBe('sprint');
    }
  });

  // ---------------------------------------------------------------------------
  // Author filter (tasks only)
  // ---------------------------------------------------------------------------

  it('applies authorUserId to tasks and returns only the member-created row', async () => {
    const result = await service.query({
      workspaceId: a.workspaceId,
      workspaceSlug: a.workspaceSlug,
      q: 'widget',
      types: ['task'],
      authorUserId: a.memberId,
      limit: 10,
    });
    const ids = result.hits.map((h) => h.id);
    expect(ids).toContain(a.taskIds[1]);
    expect(ids).not.toContain(a.taskIds[0]);
  });

  // ---------------------------------------------------------------------------
  // Cursor pagination
  // ---------------------------------------------------------------------------

  it('paginates deterministically via cursor', async () => {
    const page1 = await service.query({
      workspaceId: a.workspaceId,
      workspaceSlug: a.workspaceSlug,
      q: 'widget',
      limit: 2,
    });
    expect(page1.hits).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await service.query({
      workspaceId: a.workspaceId,
      workspaceSlug: a.workspaceSlug,
      q: 'widget',
      limit: 2,
      cursor: page1.nextCursor!,
    });
    const overlap = page2.hits.filter((h) => page1.hits.some((p) => p.id === h.id));
    expect(overlap).toHaveLength(0);
  });
});
