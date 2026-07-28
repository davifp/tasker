import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiBudgetService, currentBillingMonth } from './ai-budget.service';
import { AI_USAGE_THRESHOLD_EVENT } from './ai-budget.events';

interface UsageRow {
  workspaceId: string;
  billingMonth: string;
  tokensBudget: number;
  tokensReserved: number;
  tokensConsumed: number;
  notifiedAt80: Date | null;
  notifiedAt100: Date | null;
}

// In-memory Prisma stand-in — implements only the surface AiBudgetService
// exercises. Keeping the fake compact keeps the arithmetic under test
// obvious and independent of the real Prisma client's typings.
function makePrisma(seed: Partial<UsageRow> & { workspaceId: string; billingMonth: string }) {
  const row: UsageRow = {
    workspaceId: seed.workspaceId,
    billingMonth: seed.billingMonth,
    tokensBudget: seed.tokensBudget ?? 1000,
    tokensReserved: seed.tokensReserved ?? 0,
    tokensConsumed: seed.tokensConsumed ?? 0,
    notifiedAt80: seed.notifiedAt80 ?? null,
    notifiedAt100: seed.notifiedAt100 ?? null,
  };

  return {
    row,
    prisma: {
      forSystem: () => ({
        workspaceAiUsage: {
          upsert: vi.fn().mockResolvedValue({
            tokensBudget: row.tokensBudget,
            tokensReserved: row.tokensReserved,
            tokensConsumed: row.tokensConsumed,
            billingMonth: row.billingMonth,
          }),
          findUnique: vi.fn().mockImplementation(() =>
            Promise.resolve({
              tokensBudget: row.tokensBudget,
              tokensReserved: row.tokensReserved,
              tokensConsumed: row.tokensConsumed,
              billingMonth: row.billingMonth,
              notifiedAt80: row.notifiedAt80,
              notifiedAt100: row.notifiedAt100,
            }),
          ),
        },
        $queryRaw: vi.fn().mockImplementation((_query, ..._values) => {
          // The service uses tagged-template raw with parameter bindings for
          // the reserve() CAS increment. Our fake reads the intent from the
          // in-memory row: succeed if capacity remains, mutate the row, and
          // return one "id" like Postgres would.
          const query = String(_query);
          if (query.includes('UPDATE') && query.includes('tokensReserved')) {
            const [maxTokens] = _values;
            if (
              row.tokensReserved + row.tokensConsumed + (maxTokens as number) <=
              row.tokensBudget
            ) {
              row.tokensReserved += maxTokens as number;
              return Promise.resolve([{ id: 'usage-1' }]);
            }
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        }),
        $executeRaw: vi.fn().mockImplementation((_query, ..._values) => {
          // The reconcile UPDATE is a tagged template with two positional
          // args (tokensReserved delta, tokensConsumed delta) followed by
          // the WHERE binds.
          const [reservedDelta, consumedDelta] = _values;
          row.tokensReserved = Math.max(0, row.tokensReserved - (reservedDelta as number));
          row.tokensConsumed += consumedDelta as number;
          return Promise.resolve(1);
        }),
        $executeRawUnsafe: vi.fn().mockImplementation((query: string) => {
          // The threshold CAS is a raw string against notifiedAt80 or 100.
          if (query.includes('notifiedAt80')) {
            if (row.notifiedAt80) return Promise.resolve(0);
            row.notifiedAt80 = new Date();
            return Promise.resolve(1);
          }
          if (query.includes('notifiedAt100')) {
            if (row.notifiedAt100) return Promise.resolve(0);
            row.notifiedAt100 = new Date();
            return Promise.resolve(1);
          }
          return Promise.resolve(0);
        }),
      }),
    },
  };
}

function makeConfig(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'AI_MONTHLY_TOKEN_BUDGET') return 1000;
      return undefined;
    },
  } as unknown as ConfigService;
}

describe('AiBudgetService', () => {
  let emitter: EventEmitter2;

  beforeEach(() => {
    emitter = { emit: vi.fn().mockReturnValue(true) } as unknown as EventEmitter2;
  });

  it('currentBillingMonth returns YYYY-MM in UTC', () => {
    expect(currentBillingMonth(new Date(Date.UTC(2026, 6, 27)))).toBe('2026-07');
  });

  describe('reserve', () => {
    it('grants a reservation when capacity remains', async () => {
      const { prisma, row } = makePrisma({ workspaceId: 'ws-1', billingMonth: '2026-07' });
      const svc = new AiBudgetService(prisma as never, makeConfig(), emitter);
      const reservation = await svc.reserve('ws-1', 200);
      expect(reservation.tokens).toBe(200);
      expect(row.tokensReserved).toBe(200);
    });

    it('rejects with 402 when reservation would exceed budget', async () => {
      const { prisma } = makePrisma({
        workspaceId: 'ws-1',
        billingMonth: '2026-07',
        tokensBudget: 1000,
        tokensReserved: 800,
        tokensConsumed: 150,
      });
      const svc = new AiBudgetService(prisma as never, makeConfig(), emitter);
      const err = await svc.reserve('ws-1', 100).catch((e) => e);
      expect(err.getStatus()).toBe(402);
      expect(err.getResponse().type).toBe('about:blank#ai-budget-exhausted');
    });

    it('rejects zero or negative maxTokens', async () => {
      const { prisma } = makePrisma({ workspaceId: 'ws-1', billingMonth: '2026-07' });
      const svc = new AiBudgetService(prisma as never, makeConfig(), emitter);
      await expect(svc.reserve('ws-1', 0)).rejects.toThrow(/maxTokens/);
      await expect(svc.reserve('ws-1', -5)).rejects.toThrow(/maxTokens/);
    });
  });

  describe('reconcile', () => {
    it('releases the reservation and books actual usage', async () => {
      const { prisma, row } = makePrisma({
        workspaceId: 'ws-1',
        billingMonth: '2026-07',
        tokensReserved: 300,
      });
      const svc = new AiBudgetService(prisma as never, makeConfig(), emitter);
      await svc.reconcile({ workspaceId: 'ws-1', billingMonth: '2026-07', tokens: 300 }, 220);
      expect(row.tokensReserved).toBe(0);
      expect(row.tokensConsumed).toBe(220);
    });

    it('emits the 80% threshold exactly once (idempotent per boundary)', async () => {
      const { prisma, row } = makePrisma({
        workspaceId: 'ws-1',
        billingMonth: '2026-07',
        tokensBudget: 1000,
        tokensReserved: 800,
        tokensConsumed: 0,
      });
      const svc = new AiBudgetService(prisma as never, makeConfig(), emitter);
      // First reconcile crosses 80% → emits.
      await svc.reconcile({ workspaceId: 'ws-1', billingMonth: '2026-07', tokens: 800 }, 810);
      expect(row.notifiedAt80).toBeTruthy();
      const first = (emitter.emit as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(first).toEqual([
        [
          AI_USAGE_THRESHOLD_EVENT,
          expect.objectContaining({ percentage: 80, workspaceId: 'ws-1' }),
        ],
      ]);
      // Second reconcile still above 80% but < 100% → NO re-emit.
      await svc.reconcile({ workspaceId: 'ws-1', billingMonth: '2026-07', tokens: 0 }, 50);
      const second = (emitter.emit as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(second).toHaveLength(1);
    });

    it('emits BOTH 80% and 100% when a single reconcile crosses both boundaries', async () => {
      const { prisma } = makePrisma({
        workspaceId: 'ws-1',
        billingMonth: '2026-07',
        tokensBudget: 1000,
        tokensReserved: 1000,
        tokensConsumed: 0,
      });
      const svc = new AiBudgetService(prisma as never, makeConfig(), emitter);
      await svc.reconcile({ workspaceId: 'ws-1', billingMonth: '2026-07', tokens: 1000 }, 1050);
      const calls = (emitter.emit as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const pcts = calls
        .map((c) => (c[1] as { percentage: number }).percentage)
        .sort((a, b) => a - b);
      expect(pcts).toEqual([80, 100]);
    });

    it('does not emit the 100% threshold twice within the same billing month', async () => {
      const { prisma } = makePrisma({
        workspaceId: 'ws-1',
        billingMonth: '2026-07',
        tokensBudget: 1000,
        tokensReserved: 1000,
        tokensConsumed: 0,
      });
      const svc = new AiBudgetService(prisma as never, makeConfig(), emitter);
      await svc.reconcile({ workspaceId: 'ws-1', billingMonth: '2026-07', tokens: 1000 }, 1200);
      await svc.reconcile({ workspaceId: 'ws-1', billingMonth: '2026-07', tokens: 0 }, 50);
      const calls = (emitter.emit as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const hundreds = calls.filter((c) => (c[1] as { percentage: number }).percentage === 100);
      expect(hundreds).toHaveLength(1);
    });
  });

  describe('ensureAvailable', () => {
    it('throws when reserved + consumed already meets the budget', async () => {
      const { prisma } = makePrisma({
        workspaceId: 'ws-1',
        billingMonth: '2026-07',
        tokensBudget: 100,
        tokensReserved: 60,
        tokensConsumed: 40,
      });
      const svc = new AiBudgetService(prisma as never, makeConfig(), emitter);
      const err = await svc.ensureAvailable('ws-1').catch((e) => e);
      expect(err.getStatus()).toBe(402);
    });

    it('passes when capacity remains', async () => {
      const { prisma } = makePrisma({
        workspaceId: 'ws-1',
        billingMonth: '2026-07',
        tokensBudget: 100,
        tokensReserved: 20,
        tokensConsumed: 30,
      });
      const svc = new AiBudgetService(prisma as never, makeConfig(), emitter);
      await expect(svc.ensureAvailable('ws-1')).resolves.toBeUndefined();
    });
  });
});
