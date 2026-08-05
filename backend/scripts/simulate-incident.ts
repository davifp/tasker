// Drills the alerting path: 60 requests at 1 rps to a public throw-me route.
// See docs/adr/0004-simulated-incident.md for the checklist and expected
// downstream signals (Sentry issue, Slack, Grafana burn-rate alert).
//
// Usage: `pnpm --filter api simulate-incident` (with API running).

const BASE_URL = process.env['SIMULATE_TARGET'] ?? 'http://localhost:3001';
const PATH = '/api/v1/e2e-only/boom';
const TOTAL_REQUESTS = Number(process.env['SIMULATE_COUNT'] ?? 60);
const INTERVAL_MS = Number(process.env['SIMULATE_INTERVAL_MS'] ?? 1000);

async function fire(i: number): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}${PATH}?run=${Date.now()}&i=${i}`);
    // Expected 500 with problem+json body from ProblemDetailsFilter.
    // eslint-disable-next-line no-console
    console.log(`[${i + 1}/${TOTAL_REQUESTS}] ${res.status} ${res.statusText}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[${i + 1}/${TOTAL_REQUESTS}] request failed:`, err);
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`Simulated incident: ${TOTAL_REQUESTS} req x ${INTERVAL_MS}ms -> ${BASE_URL}${PATH}`);
  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    await fire(i);
    if (i < TOTAL_REQUESTS - 1) await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  // eslint-disable-next-line no-console
  console.log('Done. Check Sentry, Slack, and Grafana within 5 minutes.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
