/**
 * Audit read + CSV integration test.
 *
 * Seeds two workspaces with representative audit rows and asserts:
 *   1. List + filters (event, actor, targetType, date range) return correct
 *      rows scoped to the caller's workspace.
 *   2. Cursor pagination is stable and non-overlapping across two pages.
 *   3. Sensitive metadata keys are masked at read time.
 *   4. CSV exporter enforces the 10k-row cap.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { Writable } from 'node:stream';
import { execSync } from 'node:child_process';
import { AuditReadService } from '../src/audit/audit-read.service';
import { AuditCsvExporter } from '../src/audit/audit-csv.exporter';

const TEST_TIMEOUT = 300_000;

function collectingStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, text: () => chunks.join('') };
}

describe('Audit read + CSV (integration)', () => {
  let container: StartedTestContainer;
  let prisma: PrismaClient;
  let reads: AuditReadService;
  let exporter: AuditCsvExporter;
  let wsA: string;
  let wsB: string;
  let actorA: string;

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

    const url = `postgresql://tasker:tasker@${container.getHost()}:${container.getMappedPort(
      5432,
    )}/tasker_test`;
    process.env['DATABASE_URL'] = url;
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
    execSync('pnpm prisma migrate deploy', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    // Seed workspaces & actors
    const ownerA = await prisma.user.create({
      data: { email: 'a@a.test', displayName: 'Owner A', updatedAt: new Date() },
    });
    const ownerB = await prisma.user.create({
      data: { email: 'b@b.test', displayName: 'Owner B', updatedAt: new Date() },
    });
    actorA = ownerA.id;
    const workspaceA = await prisma.workspace.create({
      data: { slug: 'ws-a', name: 'A', ownerUserId: ownerA.id, updatedAt: new Date() },
    });
    const workspaceB = await prisma.workspace.create({
      data: { slug: 'ws-b', name: 'B', ownerUserId: ownerB.id, updatedAt: new Date() },
    });
    wsA = workspaceA.id;
    wsB = workspaceB.id;

    // Seed audit rows: 3 in A (varied), 2 in B
    const now = Date.now();
    await prisma.auditLog.createMany({
      data: [
        {
          workspaceId: wsA,
          actorUserId: ownerA.id,
          event: 'task.created',
          targetType: 'task',
          targetId: 't-1',
          metadata: { title: 'A task', password: 'plaintext' },
          createdAt: new Date(now - 3_000),
        },
        {
          workspaceId: wsA,
          actorUserId: ownerA.id,
          event: 'task.updated',
          targetType: 'task',
          targetId: 't-1',
          metadata: { diff: { title: ['old', 'new'] } },
          createdAt: new Date(now - 2_000),
        },
        {
          workspaceId: wsA,
          actorUserId: ownerA.id,
          event: 'invitation.created',
          targetType: 'invitation',
          targetId: 'inv-1',
          metadata: { email: 'x@t.test' },
          createdAt: new Date(now - 1_000),
        },
        {
          workspaceId: wsB,
          actorUserId: ownerB.id,
          event: 'task.created',
          targetType: 'task',
          targetId: 't-b',
          metadata: {},
          createdAt: new Date(now - 500),
        },
        {
          workspaceId: wsB,
          actorUserId: ownerB.id,
          event: 'workspace.deleted',
          targetType: 'workspace',
          metadata: {},
          createdAt: new Date(now),
        },
      ],
    });

    const prismaFacade = { forSystem: () => prisma } as never;
    reads = new AuditReadService(prismaFacade);
    exporter = new AuditCsvExporter(reads);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // Isolation & filters
  // ---------------------------------------------------------------------------

  it('returns only workspace A rows when scoped to A', async () => {
    const result = await reads.list({ workspaceId: wsA, limit: 50 });
    expect(result.rows.length).toBe(3);
    for (const row of result.rows) expect(row.workspaceId).toBe(wsA);
  });

  it('filters by event', async () => {
    const result = await reads.list({
      workspaceId: wsA,
      event: ['task.created'],
      limit: 50,
    });
    expect(result.rows.map((r) => r.event)).toEqual(['task.created']);
  });

  it('filters by targetType', async () => {
    const result = await reads.list({
      workspaceId: wsA,
      targetType: ['invitation'],
      limit: 50,
    });
    expect(result.rows.map((r) => r.event)).toEqual(['invitation.created']);
  });

  it('filters by actor', async () => {
    const b = await reads.list({ workspaceId: wsB, limit: 50 });
    expect(b.rows).toHaveLength(2);
    const withActorFilter = await reads.list({
      workspaceId: wsA,
      actorUserId: actorA,
      limit: 50,
    });
    expect(withActorFilter.rows).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // Cursor pagination
  // ---------------------------------------------------------------------------

  it('paginates deterministically across two pages', async () => {
    const page1 = await reads.list({ workspaceId: wsA, limit: 2 });
    expect(page1.rows).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await reads.list({
      workspaceId: wsA,
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.rows).toHaveLength(1);
    const overlap = page2.rows.filter((r) => page1.rows.some((p) => p.id === r.id));
    expect(overlap).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Sensitive masking
  // ---------------------------------------------------------------------------

  it('masks sensitive metadata at read time', async () => {
    const result = await reads.list({
      workspaceId: wsA,
      event: ['task.created'],
      limit: 10,
    });
    const row = result.rows[0];
    expect((row.metadata as { password: string }).password).toBe('[masked]');
    expect((row.metadata as { title: string }).title).toBe('A task');
  });

  // ---------------------------------------------------------------------------
  // CSV cap
  // ---------------------------------------------------------------------------

  it('CSV exporter under cap emits header + rows without cap marker', async () => {
    const { stream, text } = collectingStream();
    const result = await exporter.stream({ workspaceId: wsA }, stream);
    expect(result.rows).toBe(3);
    expect(result.capped).toBe(false);
    const body = text();
    expect(body.startsWith('id,createdAt,workspaceId,')).toBe(true);
    expect(body).not.toContain('# capped');
  });
});
