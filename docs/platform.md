# Platform — Public API, Webhooks, Integrations

This guide covers the three programmable surfaces shipped in Phase 10:

- **API keys** — long-lived, scoped access tokens for the public REST surface.
- **Webhooks** — signed HTTP callbacks that fire on selected workspace events.
- **Integrations** — first-party GitHub and Google Calendar connections.

## API keys

Minted from **Settings → Platform → API keys**. Every key is scoped (`tasks:read`,
`projects:write`, etc.); the raw value is shown **exactly once** at create time and
never again. The stored form is an HMAC-SHA256 hash keyed by a per-key salt.

The public REST surface is mounted under `/api/v1/public/*`:

```bash
export TSK_KEY=tsk_live_XXXXXXXXXXXX

# Introspect the acting key (any scope)
curl -sSH "Authorization: Bearer $TSK_KEY" \
  https://api.tasker.dev/api/v1/public/workspaces/<slug>/me

# List projects (requires projects:read)
curl -sSH "Authorization: Bearer $TSK_KEY" \
  https://api.tasker.dev/api/v1/public/workspaces/<slug>/projects

# Create a task (requires tasks:write + Idempotency-Key)
curl -sSH "Authorization: Bearer $TSK_KEY" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{"title":"Ship the thing"}' \
  https://api.tasker.dev/api/v1/public/workspaces/<slug>/projects/<projectSlug>/tasks
```

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset`. The bucket refills at `RATE_LIMIT_DEFAULT_PER_MIN` per key
with a burst allowance of `RATE_LIMIT_BURST`.

## Webhooks

Registered from **Settings → Platform → Webhooks**. A webhook holds a target URL,
a list of event types, and an admin-visible active flag. The signing secret is
returned once at create and once after rotation.

### Signature scheme

Outbound requests carry a Stripe-style `Tasker-Signature` header:

```
Tasker-Signature: t=1785898671,v1=<hex hmac_sha256(secret, "<t>.<rawBody>")>
```

The `t` field is the unix timestamp at which the payload was signed. Rebuild
the same string on the receiver, HMAC it with the shared secret, and compare
with `timingSafeEqual`. Reject requests older than 5 minutes.

**Node (Express):**

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

app.post('/hook', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('Tasker-Signature') ?? '';
  const { t, v1 } = Object.fromEntries(header.split(',').map((s) => s.trim().split('=')));
  if (!t || !v1) return res.status(400).end();
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return res.status(400).end();
  const expected = createHmac('sha256', process.env.TASKER_WEBHOOK_SECRET)
    .update(`${t}.${req.body.toString('utf8')}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).end();

  const event = JSON.parse(req.body.toString('utf8'));
  handle(event);
  res.status(200).end();
});
```

**Python (Flask):**

```py
import hmac, hashlib, time, os
from flask import request, abort

SECRET = os.environ['TASKER_WEBHOOK_SECRET'].encode()

@app.post('/hook')
def hook():
    header = request.headers.get('Tasker-Signature', '')
    parts = dict(p.strip().split('=', 1) for p in header.split(',') if '=' in p)
    t, v1 = parts.get('t'), parts.get('v1')
    if not t or not v1: abort(400)
    if abs(time.time() - int(t)) > 300: abort(400)
    body = request.get_data()  # raw bytes — do NOT re-serialise
    expected = hmac.new(SECRET, f'{t}.{body.decode()}'.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, v1): abort(401)
    handle(request.get_json())
    return '', 200
```

### Retry + DLQ

Failed deliveries retry with a capped exponential backoff — `base * 2^(attempt-1)`
milliseconds, clamped to `WEBHOOK_BACKOFF_CAP_MS` (default 1 h). Up to
`WEBHOOK_MAX_ATTEMPTS` (default 24) attempts, targeting a ~24-hour ceiling
regardless of how the base grows. Exhausted deliveries land in the
**dead-letter queue** and can be inspected via `GET /webhooks/:id/dlq`.
Retention is 30 days for both delivery attempts and DLQ rows.

### Key management

By default the AES-256-GCM key used to encrypt the stored signing secret is
derived from `JWT_SECRET`. To rotate secret storage independently of session
signing, set `WEBHOOK_MASTER_KEY` — the provider prefers it when non-empty
and falls back to `JWT_SECRET` otherwise. Rotating either key invalidates
existing sealed secrets, so pre-rotate: dual-write in code is not required
because the fields only exist for active subscriptions and can be rotated
via the admin UI's `Rotate secret` action.

## Integrations

Two providers ship in v1: **GitHub** (bidirectional issue/PR mirroring —
outbound mirror deferred to a follow-up) and **Google Calendar** (one-way
task/sprint export).

Connect from **Settings → Platform → Integrations**. The flow:

1. Click **Connect** on the provider card.
2. The API returns an authorize URL — you're redirected to the provider.
3. Grant consent for the requested scopes (surfaced ahead of the redirect).
4. The provider redirects back to `OAUTH_CALLBACK_BASE_URL/api/v1/integrations/<provider>/callback`.
5. The frontend posts `{code, state}` to `/complete` — the API exchanges the
   code, seals the access token with AES-256-GCM, and marks the integration
   `CONNECTED`.

Disconnect removes the `Integration` row, halting sync on the next job cycle.
Already-exported data on the provider side is preserved.

The AES key used by the token vault is derived from `INTEGRATION_MASTER_KEY`
if set (recommended), otherwise from `JWT_SECRET` for backwards compatibility.

### GitHub

- Scopes: `repo read:user` (private-repo access + login capture).
- Task ↔ issue/PR links: `POST /api/v1/workspaces/:slug/projects/:project/tasks/:number/github-links`
  with `{externalRef:"owner/repo#N", externalType:"ISSUE"|"PR"}`.
- Inbound receiver: `POST /api/v1/internal/integrations/github/events` — protected
  by `X-Hub-Signature-256` HMAC using `GITHUB_APP_WEBHOOK_SECRET`.

### Google Calendar

- Scope: `openid email https://www.googleapis.com/auth/calendar.events` — write-only
  access to events we create.
- Event mapping is deterministic: same task → same `iCalUID` across upserts,
  so Google dedupes automatically.

## Observability

Prometheus metrics are exposed at `/metrics` (unauthenticated; gate at the
ingress level). Names:

- `platform_api_requests_total{key_prefix,status}`
- `platform_api_ratelimit_hits_total{key_prefix}`
- `platform_webhook_delivery_total{outcome}` (values: `success`, `retry`, `dlq`)
- `platform_webhook_delivery_latency_seconds{outcome}` — histogram
- `platform_integration_syncs_total{provider,outcome}`
- `platform_integration_connections_total{provider,outcome}`

Grafana dashboard JSON: [`infra/grafana/dashboards/platform.json`](../infra/grafana/dashboards/platform.json).
Alert rules: [`infra/grafana/alerts/platform.yaml`](../infra/grafana/alerts/platform.yaml).
