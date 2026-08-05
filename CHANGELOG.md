# Changelog

All notable changes to Tasker are recorded here.

## Unreleased

### Added — Platform (Public API, Webhooks, Integrations)

- **API keys**: workspace-scoped `tsk_live_*` bearer tokens with scope-based
  authorisation, HMAC-SHA256 storage, per-key rate limiting, and an admin
  settings page.
- **Public REST**: `/api/v1/public/*` surface exposing `me`, projects, and
  tasks CRUD gated by API-key scopes; `X-RateLimit-*` headers on every
  response; RFC 7807 Problem Details on errors.
- **OpenAPI docs**: `/api/v1/docs` served in dev; CI-drift gate compares the
  generated schema against `openapi/baseline.json`.
- **Outbound webhooks**: workspace-scoped subscriptions with Stripe-style
  `Tasker-Signature` HMAC, BullMQ delivery with exponential backoff, dead-
  letter queue, admin UI (list + create + rotate secret + delete), and
  Prometheus metrics (`platform_webhook_delivery_total{outcome}` +
  `_latency_seconds` histogram).
- **GitHub integration**: OAuth connect/disconnect lifecycle, task ↔
  issue/PR linking, provenance-marker helpers for the future comment
  mirror, and a signature-verified inbound receiver at
  `/api/v1/internal/integrations/github/events`.
- **Google Calendar integration**: OAuth connect/disconnect lifecycle plus
  a pure event-payload mapper (stable `iCalUID`s, all-day vs scoped events,
  Google's exclusive-end convention).
- **Observability**: new Prometheus counters
  (`platform_integration_syncs_total`, `platform_integration_connections_total`),
  Grafana dashboard JSON (`infra/grafana/dashboards/platform.json`), alert
  rules (`infra/grafana/alerts/platform.yaml`), and a redaction helper
  covering `tsk_live_*`, `gh[pousr]_*`, `ya29.*`, and JWT-shaped strings.
- **Docs**: [`docs/platform.md`](docs/platform.md) with curl quickstart,
  Node/Python signature-verification snippets, and integration connect flow.

### Deferred (documented in per-task review reports)

- Bidirectional GitHub comment mirror (primitives in place; wiring pending).
- Google Calendar event export processor (mapper unit-tested; BullMQ worker pending).
- Playwright cross-flow E2E spec.
- Custom BullMQ backoff strategy enforcing the 24-hour webhook cap.
- Dedicated `WEBHOOK_MASTER_KEY` and `INTEGRATION_MASTER_KEY` env vars to
  decouple encryption from `JWT_SECRET`.
