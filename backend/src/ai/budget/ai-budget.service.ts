import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Env } from '@tasker/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_USAGE_THRESHOLD_EVENT, AiUsageThresholdEvent } from './ai-budget.events';

/**
 * Format: `YYYY-MM` in UTC. Anchoring on UTC — not the caller's local time —
 * guarantees that a workspace's rolling monthly window is the same regardless
 * of who invokes an AI action, which is the honest reading of a "monthly
 * budget per workspace" (the workspace has one clock, not one per member).
 */
export function currentBillingMonth(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

export interface BudgetReservation {
  workspaceId: string;
  billingMonth: string;
  tokens: number;
}

/**
 * Guardrail service for the per-workspace monthly AI budget.
 *
 * Two operations wrap every use-case call:
 *
 *  - `reserve(workspaceId, maxTokens)` — a **pre-flight** atomic increment on
 *    `WorkspaceAiUsage.tokensReserved`. Under a race, either the increment
 *    keeps `(reserved + consumed + delta) <= budget` and returns a
 *    `BudgetReservation`, or the row was not updated and we throw
 *    `ai-budget-exhausted` (402 Problem Details).
 *  - `reconcile(reservation, actualTokens)` — a **post-flight** compensation
 *    that releases the full reservation and books the actual usage in a
 *    single UPDATE, so bursty reservations never linger past the response.
 *
 * `reconcile()` also emits `workspace-ai-usage.threshold` at most once per
 * `notifiedAt80` / `notifiedAt100` boundary — the CAS-style update on those
 * columns is what enforces "exactly once per billing month".
 */
@Injectable()
export class AiBudgetService {
  private readonly logger = new Logger(AiBudgetService.name);
  private readonly defaultBudget: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly emitter: EventEmitter2,
  ) {
    this.defaultBudget = this.config.get('AI_MONTHLY_TOKEN_BUDGET', { infer: true });
  }

  /**
   * Fast rejection path used by guards / read paths (e.g. `GET /ai/usage`):
   * verifies that at least one token is still available for the current
   * billing month. Does NOT reserve capacity. Callers that will actually
   * invoke the provider should use `reserve()` — this method exists to
   * short-circuit before doing prompt work when the budget is already spent.
   */
  async ensureAvailable(workspaceId: string): Promise<void> {
    const usage = await this.getOrCreateCurrent(workspaceId);
    if (usage.tokensReserved + usage.tokensConsumed >= usage.tokensBudget) {
      throw this.budgetExhausted(usage.tokensBudget, usage.tokensConsumed);
    }
  }

  /**
   * Atomic conditional increment. Postgres evaluates the WHERE predicate on
   * the row's current values, so concurrent callers either both find room or
   * one of them fails without touching the row — no read-modify-write race.
   */
  async reserve(workspaceId: string, maxTokens: number): Promise<BudgetReservation> {
    if (maxTokens <= 0) throw new Error('reserve() requires maxTokens > 0');
    const billingMonth = currentBillingMonth();
    await this.getOrCreateCurrent(workspaceId, billingMonth);

    const rows = await this.prisma.forSystem().$queryRaw<Array<{ id: string }>>`
      UPDATE "WorkspaceAiUsage"
      SET "tokensReserved" = "tokensReserved" + ${maxTokens},
          "updatedAt" = NOW()
      WHERE "workspaceId" = ${workspaceId}
        AND "billingMonth" = ${billingMonth}
        AND ("tokensReserved" + "tokensConsumed" + ${maxTokens}) <= "tokensBudget"
      RETURNING "id"
    `;

    if (rows.length === 0) {
      const usage = await this.getOrCreateCurrent(workspaceId, billingMonth);
      throw this.budgetExhausted(usage.tokensBudget, usage.tokensConsumed);
    }

    return { workspaceId, billingMonth, tokens: maxTokens };
  }

  /**
   * Releases the reservation and books the actual usage in one write, then
   * fires up to one `workspace-ai-usage.threshold` event per boundary
   * crossed. Idempotent given the CAS on `notifiedAt80` / `notifiedAt100`:
   * if two reconciles cross the same threshold, only one emits.
   *
   * `actualTokens` may exceed the reservation — the provider's usage counters
   * are authoritative. We book what actually happened even if it drove us
   * over the reservation; the guard for future calls (`ensureAvailable`,
   * `reserve`) then blocks further work until the next month.
   */
  async reconcile(reservation: BudgetReservation, actualTokens: number): Promise<void> {
    if (actualTokens < 0) throw new Error('reconcile() requires actualTokens >= 0');

    await this.prisma.forSystem().$executeRaw`
      UPDATE "WorkspaceAiUsage"
      SET "tokensReserved" = GREATEST(0, "tokensReserved" - ${reservation.tokens}),
          "tokensConsumed" = "tokensConsumed" + ${actualTokens},
          "updatedAt" = NOW()
      WHERE "workspaceId" = ${reservation.workspaceId}
        AND "billingMonth" = ${reservation.billingMonth}
    `;

    // Re-read to compute thresholds against the freshly-updated row.
    const usage = await this.prisma.forSystem().workspaceAiUsage.findUnique({
      where: {
        workspaceId_billingMonth: {
          workspaceId: reservation.workspaceId,
          billingMonth: reservation.billingMonth,
        },
      },
    });
    if (!usage) return;

    const ratio = usage.tokensConsumed / usage.tokensBudget;
    if (ratio >= 1) {
      await this.emitThresholdOnce(reservation.workspaceId, reservation.billingMonth, 100, usage);
    }
    if (ratio >= 0.8) {
      await this.emitThresholdOnce(reservation.workspaceId, reservation.billingMonth, 80, usage);
    }
  }

  /**
   * Reads the current-month row (creating the seed row if missing). Read
   * paths in the controller use this for the `GET /ai/usage` dashboard.
   */
  async getCurrentUsage(workspaceId: string): Promise<{
    workspaceId: string;
    billingMonth: string;
    tokensBudget: number;
    tokensReserved: number;
    tokensConsumed: number;
  }> {
    const usage = await this.getOrCreateCurrent(workspaceId);
    return {
      workspaceId,
      billingMonth: usage.billingMonth,
      tokensBudget: usage.tokensBudget,
      tokensReserved: usage.tokensReserved,
      tokensConsumed: usage.tokensConsumed,
    };
  }

  private async getOrCreateCurrent(
    workspaceId: string,
    billingMonth: string = currentBillingMonth(),
  ): Promise<{
    tokensBudget: number;
    tokensReserved: number;
    tokensConsumed: number;
    billingMonth: string;
  }> {
    return this.prisma.forSystem().workspaceAiUsage.upsert({
      where: { workspaceId_billingMonth: { workspaceId, billingMonth } },
      create: {
        workspaceId,
        billingMonth,
        tokensBudget: this.defaultBudget,
        updatedAt: new Date(),
      },
      update: {},
      select: {
        tokensBudget: true,
        tokensReserved: true,
        tokensConsumed: true,
        billingMonth: true,
      },
    });
  }

  /**
   * CAS-style single-writer: the UPDATE only sets `notifiedAt80/100` when
   * it is currently NULL. If two reconciles fire the same threshold
   * concurrently, exactly one UPDATE affects the row and emits the event.
   */
  private async emitThresholdOnce(
    workspaceId: string,
    billingMonth: string,
    percentage: 80 | 100,
    snapshot: { tokensConsumed: number; tokensBudget: number },
  ): Promise<void> {
    const column = percentage === 80 ? 'notifiedAt80' : 'notifiedAt100';
    const updated = await this.prisma.forSystem().$executeRawUnsafe(
      `UPDATE "WorkspaceAiUsage"
       SET "${column}" = NOW(),
           "updatedAt" = NOW()
       WHERE "workspaceId" = $1
         AND "billingMonth" = $2
         AND "${column}" IS NULL`,
      workspaceId,
      billingMonth,
    );
    if (updated === 0) return;

    const event: AiUsageThresholdEvent = {
      workspaceId,
      billingMonth,
      percentage,
      tokensConsumed: snapshot.tokensConsumed,
      tokensBudget: snapshot.tokensBudget,
    };
    this.emitter.emit(AI_USAGE_THRESHOLD_EVENT, event);
    this.logger.log(
      { workspaceId, billingMonth, percentage },
      'Emitted workspace-ai-usage.threshold',
    );
  }

  private budgetExhausted(budget: number, consumed: number): HttpException {
    return new HttpException(
      {
        type: 'about:blank#ai-budget-exhausted',
        title: 'AI monthly budget exhausted',
        detail:
          'The workspace has reached its monthly AI token budget. Contact an admin ' +
          'or wait until the next billing cycle.',
        status: 402,
        tokensBudget: budget,
        tokensConsumed: consumed,
      },
      402,
    );
  }
}
