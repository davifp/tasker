/**
 * AiBudgetService concurrency integration test.
 *
 * Boots real Postgres via testcontainers, applies every migration, then
 * fires N parallel `reserve()` calls whose combined size would exceed the
 * workspace's monthly budget. Under the atomic conditional increment used
 * by `AiBudgetService.reserve()`, the sum of successful reservations MUST
 * never exceed `tokensBudget`, no matter how many callers race — every
 * overshoot must surface as `ai-budget-exhausted` (402).
 *
 * This is the guarantee we cannot cover with a mocked Prisma test: the
 * behaviour depends on Postgres' row-level locking during the conditional
 * UPDATE.
 */
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiBudgetService } from '../src/ai/budget/ai-budget.service';

const TEST_TIMEOUT = 180_000;
const BUDGET = 1_000;
const RESERVATION = 100;
const PARALLEL_CALLS = 20; // 20 * 100 = 2000, twice the budget

describe('AiBudgetService concurrency (integration)', () => {
  let container: StartedTestContainer;
  let raw: PrismaClient;
  let workspaceId: string;

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
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    const user = await raw.user.create({
      data: { email: 'ai-budget@ws.test', displayName: 'Budget Tester', updatedAt: new Date() },
    });
    const ws = await raw.workspace.create({
      data: {
        slug: 'ai-budget-ws',
        name: 'Budget Workspace',
        ownerUserId: user.id,
        updatedAt: new Date(),
      },
    });
    workspaceId = ws.id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await raw?.$disconnect();
    await container?.stop();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    // Fresh usage row per test — the CAS on notifiedAt* would otherwise
    // pollute the "emits at 80%" assertion across suites.
    await raw.workspaceAiUsage.deleteMany({ where: { workspaceId } });
  });

  function service(prisma: PrismaClient): AiBudgetService {
    const config = {
      get: (key: string) => (key === 'AI_MONTHLY_TOKEN_BUDGET' ? BUDGET : undefined),
    } as unknown as ConfigService;
    const emitter = { emit: () => true } as unknown as EventEmitter2;
    // Adapter over the raw PrismaClient to satisfy the service's expected
    // `prisma.forSystem()` shape. The service also uses `$queryRaw`,
    // `$executeRaw`, `$executeRawUnsafe`, and `workspaceAiUsage.*`.
    const adapter = {
      forSystem: () => prisma,
    } as unknown as ConstructorParameters<typeof AiBudgetService>[0];
    return new AiBudgetService(adapter, config, emitter);
  }

  it('grants exactly floor(BUDGET / RESERVATION) reservations under a race, rejects the rest', async () => {
    const svc = service(raw);
    // Seed the current-month row deterministically so the concurrency test
    // doesn't rely on `upsert` races (that is a separate contract).
    await svc.ensureAvailable(workspaceId).catch(() => undefined);

    const outcomes = await Promise.allSettled(
      Array.from({ length: PARALLEL_CALLS }, () => svc.reserve(workspaceId, RESERVATION)),
    );

    const granted = outcomes.filter((o) => o.status === 'fulfilled').length;
    const rejected = outcomes.filter((o) => o.status === 'rejected').length;
    expect(granted).toBe(BUDGET / RESERVATION);
    expect(rejected).toBe(PARALLEL_CALLS - BUDGET / RESERVATION);

    // Every rejection MUST be the Problem Details 402.
    const rejects = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    for (const r of rejects) {
      const err = r.reason as { getStatus?: () => number; getResponse?: () => { type: string } };
      expect(err.getStatus?.()).toBe(402);
      expect(err.getResponse?.().type).toBe('about:blank#ai-budget-exhausted');
    }

    const usage = await raw.workspaceAiUsage.findFirst({ where: { workspaceId } });
    expect(usage?.tokensReserved).toBe(BUDGET);
  });

  it('reconcile releases the reservation and books the actual usage', async () => {
    const svc = service(raw);
    const reservation = await svc.reserve(workspaceId, 500);
    await svc.reconcile(reservation, 300);
    const usage = await raw.workspaceAiUsage.findFirst({ where: { workspaceId } });
    expect(usage?.tokensReserved).toBe(0);
    expect(usage?.tokensConsumed).toBe(300);
  });

  it('respects the monthly boundary — a new billingMonth gets a fresh row', async () => {
    const svc = service(raw);
    await svc.reserve(workspaceId, 900);
    await svc.reconcile(
      {
        workspaceId,
        billingMonth: (await svc.getCurrentUsage(workspaceId)).billingMonth,
        tokens: 900,
      },
      900,
    );
    const rows = await raw.workspaceAiUsage.findMany({ where: { workspaceId } });
    expect(rows).toHaveLength(1); // still only one row, current month
    expect(rows[0].tokensConsumed).toBe(900);
  });
});
