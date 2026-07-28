/**
 * AI Actions schema integration test.
 *
 * Boots a real Postgres 16 container, applies every migration (including
 * `0010_ai_actions_init`), and asserts the properties introduced by Phase 9
 * Task 1.0:
 *
 *   1. Each of the four new models (WorkspaceAiConsent, WorkspaceAiUsage,
 *      AiInvocation, AiFeedback) can round-trip a CRUD insert + read.
 *   2. Uniqueness on `WorkspaceAiConsent.workspaceId` (one consent per
 *      workspace) is enforced.
 *   3. Uniqueness on `WorkspaceAiUsage(workspaceId, billingMonth)` prevents
 *      concurrent duplicate rows for the same month.
 *   4. Uniqueness on `AiFeedback(invocationId, createdByUserId)` prevents a
 *      single user from double-rating the same invocation.
 *   5. FK integrity: an `AiFeedback` row cannot reference a missing
 *      invocation.
 *   6. Cascade on workspace deletion sweeps consent, usage, invocations,
 *      and feedback.
 *
 * Requires Docker to be available in the test environment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { Prisma, PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

const TEST_TIMEOUT = 180_000;

interface Seed {
  wsA: string;
  wsB: string;
  userA: string;
  userB: string;
}

async function seed(raw: PrismaClient): Promise<Seed> {
  const uA = await raw.user.create({
    data: { email: 'ai-a@ws.test', displayName: 'Alice', updatedAt: new Date() },
  });
  const uB = await raw.user.create({
    data: { email: 'ai-b@ws.test', displayName: 'Bob', updatedAt: new Date() },
  });
  const wA = await raw.workspace.create({
    data: { slug: 'ai-a', name: 'AI Workspace A', ownerUserId: uA.id, updatedAt: new Date() },
  });
  const wB = await raw.workspace.create({
    data: { slug: 'ai-b', name: 'AI Workspace B', ownerUserId: uB.id, updatedAt: new Date() },
  });
  return { wsA: wA.id, wsB: wB.id, userA: uA.id, userB: uB.id };
}

describe('AI Actions schema (integration)', () => {
  let container: StartedTestContainer;
  let raw: PrismaClient;
  let s: Seed;

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

    s = await seed(raw);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await raw?.$disconnect();
    await container?.stop();
  }, TEST_TIMEOUT);

  // -------------------------------------------------------------------------
  // CRUD round-trips per model
  // -------------------------------------------------------------------------

  describe('CRUD round-trip', () => {
    it('WorkspaceAiConsent inserts and reads back', async () => {
      const created = await raw.workspaceAiConsent.create({
        data: {
          workspaceId: s.wsA,
          acceptedByUserId: s.userA,
          documentVersion: 'v1',
          updatedAt: new Date(),
        },
      });
      const found = await raw.workspaceAiConsent.findUnique({ where: { workspaceId: s.wsA } });
      expect(found?.id).toBe(created.id);
      expect(found?.documentVersion).toBe('v1');
    });

    it('WorkspaceAiUsage inserts and reads back', async () => {
      await raw.workspaceAiUsage.create({
        data: {
          workspaceId: s.wsA,
          billingMonth: '2026-07',
          tokensBudget: 100_000,
          updatedAt: new Date(),
        },
      });
      const found = await raw.workspaceAiUsage.findUnique({
        where: {
          workspaceId_billingMonth: { workspaceId: s.wsA, billingMonth: '2026-07' },
        },
      });
      expect(found?.tokensBudget).toBe(100_000);
      expect(found?.tokensReserved).toBe(0);
      expect(found?.tokensConsumed).toBe(0);
    });

    it('AiInvocation inserts with the four enum actions', async () => {
      const inv = await raw.aiInvocation.create({
        data: {
          workspaceId: s.wsA,
          actorUserId: s.userA,
          action: 'GENERATE_DESCRIPTION',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          inputTokens: 1200,
          outputTokens: 350,
          cachedInputTokens: 800,
          latencyMs: 1420,
          status: 'OK',
        },
      });
      const found = await raw.aiInvocation.findUnique({ where: { id: inv.id } });
      expect(found?.action).toBe('GENERATE_DESCRIPTION');
      expect(found?.status).toBe('OK');
      expect(found?.cachedInputTokens).toBe(800);
    });

    it('AiFeedback inserts and reads back with a rating and reason', async () => {
      const inv = await raw.aiInvocation.create({
        data: {
          workspaceId: s.wsA,
          actorUserId: s.userA,
          action: 'SUMMARIZE_COMMENTS',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          status: 'OK',
        },
      });
      const fb = await raw.aiFeedback.create({
        data: {
          workspaceId: s.wsA,
          invocationId: inv.id,
          createdByUserId: s.userA,
          rating: 'NEGATIVE',
          reason: 'missed the key decision',
        },
      });
      expect(fb.rating).toBe('NEGATIVE');
      expect(fb.reason).toBe('missed the key decision');
    });
  });

  // -------------------------------------------------------------------------
  // Uniqueness constraints
  // -------------------------------------------------------------------------

  describe('Uniqueness constraints', () => {
    it('rejects a second WorkspaceAiConsent for the same workspace', async () => {
      // wsA already has consent from the CRUD test — a second insert must fail.
      await expect(
        raw.workspaceAiConsent.create({
          data: {
            workspaceId: s.wsA,
            acceptedByUserId: s.userA,
            documentVersion: 'v2',
            updatedAt: new Date(),
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('rejects duplicate WorkspaceAiUsage rows for the same (workspaceId, billingMonth)', async () => {
      await expect(
        raw.workspaceAiUsage.create({
          data: {
            workspaceId: s.wsA,
            billingMonth: '2026-07',
            tokensBudget: 999,
            updatedAt: new Date(),
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('allows the same workspace to have separate rows for different billing months', async () => {
      const other = await raw.workspaceAiUsage.create({
        data: {
          workspaceId: s.wsA,
          billingMonth: '2026-08',
          tokensBudget: 250_000,
          updatedAt: new Date(),
        },
      });
      expect(other.billingMonth).toBe('2026-08');
    });

    it('rejects a second AiFeedback from the same user on the same invocation', async () => {
      const inv = await raw.aiInvocation.create({
        data: {
          workspaceId: s.wsB,
          actorUserId: s.userB,
          action: 'GENERATE_CHECKLIST',
          provider: 'openai',
          model: 'gpt-4o-mini',
          status: 'OK',
        },
      });
      await raw.aiFeedback.create({
        data: {
          workspaceId: s.wsB,
          invocationId: inv.id,
          createdByUserId: s.userB,
          rating: 'POSITIVE',
        },
      });
      await expect(
        raw.aiFeedback.create({
          data: {
            workspaceId: s.wsB,
            invocationId: inv.id,
            createdByUserId: s.userB,
            rating: 'NEGATIVE',
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  // -------------------------------------------------------------------------
  // Referential integrity
  // -------------------------------------------------------------------------

  describe('Referential integrity', () => {
    it('rejects AiFeedback referencing a missing invocation', async () => {
      await expect(
        raw.aiFeedback.create({
          data: {
            workspaceId: s.wsA,
            invocationId: 'nonexistent-invocation-id',
            createdByUserId: s.userA,
            rating: 'POSITIVE',
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('cascades deletion of a workspace to its AI rows', async () => {
      const tmpUser = await raw.user.create({
        data: {
          email: 'ai-cascade@ws.test',
          displayName: 'Casc',
          updatedAt: new Date(),
        },
      });
      const tmpWs = await raw.workspace.create({
        data: {
          slug: 'ai-cascade',
          name: 'AI Cascade WS',
          ownerUserId: tmpUser.id,
          updatedAt: new Date(),
        },
      });
      await raw.workspaceAiConsent.create({
        data: {
          workspaceId: tmpWs.id,
          acceptedByUserId: tmpUser.id,
          documentVersion: 'v1',
          updatedAt: new Date(),
        },
      });
      await raw.workspaceAiUsage.create({
        data: {
          workspaceId: tmpWs.id,
          billingMonth: '2026-07',
          tokensBudget: 100,
          updatedAt: new Date(),
        },
      });
      const inv = await raw.aiInvocation.create({
        data: {
          workspaceId: tmpWs.id,
          actorUserId: tmpUser.id,
          action: 'ESTIMATE_AND_SUGGEST',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          status: 'OK',
        },
      });
      await raw.aiFeedback.create({
        data: {
          workspaceId: tmpWs.id,
          invocationId: inv.id,
          createdByUserId: tmpUser.id,
          rating: 'POSITIVE',
        },
      });

      await raw.workspace.delete({ where: { id: tmpWs.id } });

      const [consent, usage, invocations, feedback] = await Promise.all([
        raw.workspaceAiConsent.findMany({ where: { workspaceId: tmpWs.id } }),
        raw.workspaceAiUsage.findMany({ where: { workspaceId: tmpWs.id } }),
        raw.aiInvocation.findMany({ where: { workspaceId: tmpWs.id } }),
        raw.aiFeedback.findMany({ where: { workspaceId: tmpWs.id } }),
      ]);
      expect(consent).toHaveLength(0);
      expect(usage).toHaveLength(0);
      expect(invocations).toHaveLength(0);
      expect(feedback).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Index presence (introspection against information_schema)
  // -------------------------------------------------------------------------

  describe('Index presence', () => {
    it('exposes the composite indexes declared in the schema', async () => {
      const rows = await raw.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN
         ('WorkspaceAiConsent','WorkspaceAiUsage','AiInvocation','AiFeedback')`,
      );
      const names = rows.map((r) => r.indexname);
      expect(names).toEqual(
        expect.arrayContaining([
          'WorkspaceAiConsent_workspaceId_key',
          'WorkspaceAiUsage_workspaceId_billingMonth_key',
          'WorkspaceAiUsage_workspaceId_createdAt_idx',
          'AiInvocation_workspaceId_createdAt_idx',
          'AiInvocation_workspaceId_action_createdAt_idx',
          'AiInvocation_workspaceId_actorUserId_createdAt_idx',
          'AiFeedback_invocationId_createdByUserId_key',
          'AiFeedback_workspaceId_createdAt_idx',
          'AiFeedback_invocationId_idx',
        ]),
      );
    });
  });
});
