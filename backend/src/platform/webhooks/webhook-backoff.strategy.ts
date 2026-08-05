export const WEBHOOK_BACKOFF_STRATEGY_NAME = 'webhook-capped-exponential' as const;

const DEFAULT_BASE_MS = 1000;
const DEFAULT_CAP_MS = 3_600_000;

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export function webhookBackoffStrategy(attemptsMade: number): number {
  const base = toPositiveInt(process.env['WEBHOOK_BACKOFF_BASE_MS'], DEFAULT_BASE_MS);
  const cap = toPositiveInt(process.env['WEBHOOK_BACKOFF_CAP_MS'], DEFAULT_CAP_MS);
  const exp = Math.round(Math.pow(2, Math.max(0, attemptsMade - 1)) * base);
  return Math.min(exp, cap);
}
