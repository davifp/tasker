# ADR 0004 — Simulated incident drill

## Status

Accepted (Task 4.0)

## Context

FR-4.4 requires that a simulated incident produce an alert to the on-call channel within 5 minutes. The alerting stack layered so far:

- **Backend** captures uncaught exceptions and 5xx responses via `Sentry.captureException` (Task 4.0).
- **Sentry** groups by fingerprint and (with the alert rule configured in the UI) forwards to the on-call channel.
- **Grafana** raises `ApiErrorBudgetFastBurn` when the 5xx rate exceeds 14x the SLO burn budget over 5 min.

We need a repeatable drill that exercises both paths without waiting for a real outage.

## Decision

Ship a small script (`backend/scripts/simulate-incident.ts`) that throws a synthetic exception once per second for 60 seconds through the API. Calls a `@Public()` test-only route registered behind `E2E_ROUTES_ENABLED=1` so no production build carries a "throw me" endpoint by accident.

Alerting configuration lives outside the code:

1. In **Sentry**, create an alert rule "5xx rate > 5/min" routing to `#tasker-oncall` in Slack.
2. In **Grafana**, the `ApiErrorBudgetFastBurn` alert already routes via the same channel through Grafana's contact point.

## Drill checklist

1. Ensure `SENTRY_DSN` is populated in the environment and `E2E_ROUTES_ENABLED=1` on the API.
2. Boot API + Prometheus + Grafana.
3. `pnpm --filter api simulate-incident` — the script issues 60 requests to `/api/v1/e2e-only/boom` at 1 rps.
4. Confirm within 5 minutes:
   - Sentry shows an issue titled "Simulated incident" with 60 events.
   - Slack receives the Sentry alert.
   - Grafana raises `ApiErrorBudgetFastBurn`.
5. Log the drill outcome in `docs/adr/drills/YYYY-MM-DD.md`.

## Consequences

- Every deploy can rerun the drill in isolation; failures indicate a misconfigured alert route rather than a bug in the app.
- The synthetic route is guarded by `NODE_ENV !== 'production'` (or explicit `E2E_ROUTES_ENABLED=1`), so it never registers in a real production build unless deliberately enabled for the drill.
