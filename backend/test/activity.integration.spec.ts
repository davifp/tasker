/**
 * Integration test for the Activity subsystem (Task 3.0).
 *
 * Boots real Postgres, applies migrations, then exercises:
 *   - ActivityService.record() inside a Prisma $transaction — the domain
 *     row and the activity row commit atomically.
 *   - listForTask / listForProject: newest-first ordering, cursor
 *     pagination, workspace scoping.
 *   - Cross-workspace isolation: an activity written in ws A is not visible
 *     to a query scoped to ws B.
 *
 * Requires Docker (Testcontainers).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { ActivityBus } from '../src/common/activity/activity.bus';
import { ActivityService } from '../src/common/activity/activity.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const TEST_TIMEOUT = 120_000;

async function seedWorkspace(raw: PrismaClient, slug: string) {
  const user = await raw.user.create({
    data: { email: `${slug}@t.test`, displayName: slug, updatedAt: new Date() },
  });
  const workspace = await raw.workspace.create({
    data: {
      slug,
      name: slug,
      ownerUserId: user.id,
      updatedAt: new Date(),
    },
  });
  await raw.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: 'OWNER',
      updatedAt: new Date(),
    },
  });
  const project = await raw.project.create({
    data: {
      workspaceId: workspace.id,
      slug: `${slug}-p`,
      name: 'P',
      color: '#3b82f6',
      icon: 'Package',
      ownerUserId: user.id,
      createdByUserId: user.id,
      updatedAt: new Date(),
    },
  });
  const task = await raw.task.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      number: 1,
      title: 'Task 1',
      position: 'a0',
      createdByUserId: user.id,
      updatedAt: new Date(),
    },
  });
  return { user, workspace, project, task };
}

describe('Activity module (integration)', () => {
  let container: StartedTestContainer;
  let raw: PrismaClient;
  let service: ActivityService;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_DB: 'tasker_activity',
        POSTGRES_USER: 'tasker',
        POSTGRES_PASSWORD: 'tasker',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();

    const url = `postgresql://tasker:tasker@${container.getHost()}:${container.getMappedPort(5432)}/tasker_activity`;
    process.env['DATABASE_URL'] = url;
    raw = new PrismaClient({ datasources: { db: { url } } });
    await raw.$connect();

    execSync('pnpm prisma migrate deploy', {
      cwd: '/home/davi/tasker/backend',
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    const prismaService = {
      forSystem: () => raw,
    } as unknown as PrismaService;
    const bus = new ActivityBus(new EventEmitter2({ wildcard: false, delimiter: '.' }));
    service = new ActivityService(prismaService, bus);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await raw?.$disconnect();
    await container?.stop();
  }, TEST_TIMEOUT);

  it('writes an Activity row inside the caller-supplied transaction', async () => {
    const seed = await seedWorkspace(raw, 'ws-a');

    // Emulate a real caller: update the task and record an activity in one tx.
    await raw.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: seed.task.id },
        data: { status: 'IN_PROGRESS' },
      });
      await service.record(tx, {
        workspaceId: seed.workspace.id,
        projectId: seed.project.id,
        taskId: seed.task.id,
        actorUserId: seed.user.id,
        verb: 'task.status_changed',
        payload: {
          actorDisplayName: seed.user.displayName,
          targetTitle: seed.task.title,
          from: 'BACKLOG',
          to: 'IN_PROGRESS',
        },
      });
    });

    const rows = await raw.activity.findMany({
      where: { workspaceId: seed.workspace.id, taskId: seed.task.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verb).toBe('task.status_changed');
    expect(rows[0]!.payload).toMatchObject({ from: 'BACKLOG', to: 'IN_PROGRESS' });
  });

  it('lists activity newest-first with cursor pagination', async () => {
    const seed = await seedWorkspace(raw, 'ws-b');

    for (let i = 0; i < 5; i++) {
      await raw.$transaction(async (tx) => {
        await service.record(tx, {
          workspaceId: seed.workspace.id,
          projectId: seed.project.id,
          taskId: seed.task.id,
          actorUserId: seed.user.id,
          verb: 'comment.created',
          payload: { commentExcerpt: `comment ${i}` },
        });
      });
    }

    const page1 = await service.listForTask(seed.workspace.id, seed.task.id, { limit: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await service.listForTask(seed.workspace.id, seed.task.id, {
      limit: 3,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    // No overlap: page1 last id must not appear in page2.
    const page1Ids = new Set(page1.items.map((i) => i.id));
    expect(page2.items.every((i) => !page1Ids.has(i.id))).toBe(true);
  });

  it('scopes reads to the caller workspace (cross-workspace isolation)', async () => {
    const seedA = await seedWorkspace(raw, 'ws-iso-a');
    const seedB = await seedWorkspace(raw, 'ws-iso-b');

    await raw.$transaction(async (tx) => {
      await service.record(tx, {
        workspaceId: seedA.workspace.id,
        projectId: seedA.project.id,
        taskId: seedA.task.id,
        actorUserId: seedA.user.id,
        verb: 'comment.created',
        payload: { commentExcerpt: 'from ws-a' },
      });
    });

    // Query as ws-b — must see zero activity for task belonging to ws-a.
    const asB = await service.listForTask(seedB.workspace.id, seedA.task.id);
    expect(asB.items).toHaveLength(0);

    // Query as ws-a — must see the row.
    const asA = await service.listForTask(seedA.workspace.id, seedA.task.id);
    expect(asA.items).toHaveLength(1);
    expect(asA.items[0]!.payload).toMatchObject({ commentExcerpt: 'from ws-a' });
  });

  it('lists project-scoped activity across all tasks in the project', async () => {
    const seed = await seedWorkspace(raw, 'ws-proj');
    // Create a second task in the same project.
    const task2 = await raw.task.create({
      data: {
        workspaceId: seed.workspace.id,
        projectId: seed.project.id,
        number: 2,
        title: 'Task 2',
        position: 'b0',
        createdByUserId: seed.user.id,
        updatedAt: new Date(),
      },
    });

    for (const taskId of [seed.task.id, task2.id]) {
      await raw.$transaction(async (tx) => {
        await service.record(tx, {
          workspaceId: seed.workspace.id,
          projectId: seed.project.id,
          taskId,
          actorUserId: seed.user.id,
          verb: 'comment.created',
          payload: {},
        });
      });
    }

    const feed = await service.listForProject(seed.workspace.id, seed.project.id);
    expect(feed.items.length).toBeGreaterThanOrEqual(2);
    expect(feed.items.every((i) => i.projectId === seed.project.id)).toBe(true);
  });
});
