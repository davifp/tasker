import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // App
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),

  // Sessions
  SESSION_TTL_DAYS: z.coerce.number().default(30),

  // SMTP
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('"Tasker" <noreply@tasker.dev>'),
  SMTP_SECURE: z.string().default('false'),

  // Token TTLs (seconds)
  EMAIL_VERIFY_TTL_S: z.coerce.number().default(86400),
  PASSWORD_RESET_TTL_S: z.coerce.number().default(3600),

  // OAuth
  // Callback base URL for building the redirect_uri passed to providers.
  // Providers must have {OAUTH_CALLBACK_BASE_URL}/api/v1/auth/oauth/{provider}/callback registered.
  OAUTH_CALLBACK_BASE_URL: z.string().url().default('http://localhost:3001'),
  OAUTH_SUCCESS_REDIRECT_URL: z.string().url().default('http://localhost:3000/auth/oauth/callback'),
  OAUTH_STATE_TTL_S: z.coerce.number().default(600),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),

  // Throttler — global default (covers every route not opted-out by a named
  // throttler's skipIf). Production stays at 100/60s; E2E lifts these to
  // avoid tripping on high-volume seed fixtures (see playwright.config.ts).
  THROTTLE_DEFAULT_LIMIT: z.coerce.number().default(100),
  THROTTLE_DEFAULT_TTL_S: z.coerce.number().default(60),

  // Throttler (auth endpoints)
  THROTTLE_REGISTER_LIMIT: z.coerce.number().default(5),
  THROTTLE_REGISTER_TTL_S: z.coerce.number().default(60),
  THROTTLE_LOGIN_LIMIT: z.coerce.number().default(5),
  THROTTLE_LOGIN_TTL_S: z.coerce.number().default(60),
  THROTTLE_REFRESH_LIMIT: z.coerce.number().default(20),
  THROTTLE_REFRESH_TTL_S: z.coerce.number().default(60),
  THROTTLE_EMAIL_RESEND_LIMIT: z.coerce.number().default(3),
  THROTTLE_EMAIL_RESEND_TTL_S: z.coerce.number().default(300),
  THROTTLE_PASSWORD_RESET_LIMIT: z.coerce.number().default(3),
  THROTTLE_PASSWORD_RESET_TTL_S: z.coerce.number().default(300),

  // Cleanup cron (purges expired tokens, expired sessions, and workspaces past their purge window).
  CLEANUP_CRON: z.string().default('0 3 * * *'),
  // Days before purgeAt to email the Owner a warning. Idempotent per (workspaceId, purgeAt).
  PURGE_WARNING_LEAD_DAYS: z.coerce.number().default(3),
  // Days after Session.expiresAt to keep the row around before hard-deleting it.
  SESSION_RETENTION_DAYS: z.coerce.number().default(7),

  // Object storage (S3-compatible: AWS S3, Cloudflare R2, MinIO).
  // The bucket must exist before the API starts writing; docker-compose
  // provisions a `tasker-attachments` bucket via the `minio-init` job.
  STORAGE_ENDPOINT: z.string().url().default('http://localhost:9000'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().min(1).default('tasker-attachments'),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).default('minioadmin'),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).default('minioadmin'),
  // MinIO requires path-style (bucket name in the URL, not the hostname).
  // AWS S3 accepts both; R2 requires virtual-hosted style — set to 'false'
  // in production against R2.
  STORAGE_FORCE_PATH_STYLE: z
    .union([z.enum(['true', 'false']), z.boolean()])
    .default('true')
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true')),
  // Presigned URL lifetimes; short enough that stolen URLs die fast, long
  // enough that a chunked upload from a slow client can complete.
  STORAGE_PUT_URL_TTL_S: z.coerce.number().int().positive().default(60),
  STORAGE_GET_URL_TTL_S: z.coerce.number().int().positive().default(300),

  // BullMQ health thresholds (report degraded above these).
  BULLMQ_HEALTH_MAX_WAITING: z.coerce.number().default(1000),
  BULLMQ_HEALTH_MAX_STALLED: z.coerce.number().default(10),
  // Max time to wait for BullMQ queue introspection before reporting degraded
  // (protects /health from hanging when Redis is unreachable).
  BULLMQ_HEALTH_TIMEOUT_MS: z.coerce.number().default(2000),
  // Max time to wait for the cleanup repeatable-job registration at boot
  // (protects app.listen from blocking when Redis is unreachable).
  CLEANUP_REGISTER_TIMEOUT_MS: z.coerce.number().default(2000),

  // Realtime (Phase 8) — Socket.IO ticket lifetime and signing key.
  // Ticket is one-shot: jti is stored in Redis with the same TTL, so a
  // replayed ticket is rejected. Rotating RT_TICKET_SECRET invalidates
  // in-flight tickets without affecting the underlying JWT session.
  RT_TICKET_TTL_S: z.coerce.number().int().positive().default(60),
  RT_TICKET_SECRET: z.string().min(32),
  // Comma-separated list of origins allowed to open the Socket.IO handshake.
  // The API is on a different origin from the web app, so CORS on the WS
  // upgrade must be explicit.
  RT_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Web Push (Phase 8). VAPID keys can be generated with
  // `pnpm exec web-push generate-vapid-keys`. VAPID_SUBJECT identifies the
  // sender to push services; must be a mailto: URL or https URL.
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:noreply@tasker.dev'),

  // Notification delivery timing (Phase 8). Email batching flushes every
  // NOTIF_EMAIL_BATCH_WINDOW_S seconds per recipient; deduplication collapses
  // (recipient × eventType × sourceId) bursts inside NOTIF_DEDUPE_WINDOW_S.
  NOTIF_EMAIL_BATCH_WINDOW_S: z.coerce.number().int().positive().default(300),
  NOTIF_DEDUPE_WINDOW_S: z.coerce.number().int().positive().default(60),

  // AI Actions (Phase 9). Provider selection is config-driven so we can flip
  // the default per environment without a code change. Keys are optional in
  // development/test — adapters fall through to a placeholder that only fails
  // when actually invoked. `AI_FALLBACK_PROVIDER` opts into the router's
  // single-shot fallback on transient errors; when unset, transient failures
  // surface directly as `about:blank#ai-provider-unavailable` (503).
  ANTHROPIC_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  // Optional overrides that let the OpenAI adapter target any OpenAI-compatible
  // provider (Groq, OpenRouter, Mistral, Cerebras, Together, DeepSeek, …)
  // without a code change. `AI_OPENAI_BASE_URL` unset → hits api.openai.com;
  // `AI_OPENAI_MODEL` unset → adapter's built-in default (gpt-4o-mini).
  AI_OPENAI_BASE_URL: z.string().url().optional(),
  AI_OPENAI_MODEL: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  AI_FALLBACK_PROVIDER: z.enum(['anthropic', 'openai']).optional(),
  // Default per-workspace monthly token budget (in output-equivalent tokens).
  // Overridable per workspace via WorkspaceAiUsage.tokensBudget seeded at
  // consent time; this value is the seed default.
  AI_MONTHLY_TOKEN_BUDGET: z.coerce.number().int().positive().default(1_000_000),
  // Bumped when the AI data-sharing consent document changes. Existing
  // WorkspaceAiConsent rows with a stale documentVersion are treated as
  // "not accepted" until the admin re-accepts.
  AI_CONSENT_DOCUMENT_VERSION: z.string().default('v1'),
  // Per-user rate limit on AI action endpoints (see AppModule throttler set).
  THROTTLE_AI_ACTION_LIMIT: z.coerce.number().default(30),
  THROTTLE_AI_ACTION_TTL_S: z.coerce.number().default(60),

  // Platform (Phase 10) — Public API, Webhooks, Integrations.
  //
  // API keys carry a visible prefix so leaked-key scanners (GitHub Secret
  // Scanning, TruffleHog, git-secrets) can flag them by regex; the default
  // uses `tsk_live` for prod parity but the env var lets each environment
  // pick its own prefix (e.g. `tsk_test` for staging) without a code change.
  API_KEY_PREFIX: z.string().default('tsk_live'),

  // Outbound webhook delivery. `attempts` × exponential backoff (base_ms → cap_ms)
  // targets a ~24 h ceiling (PRD FR-21). Values are exposed as env so ops can
  // tighten the SLA per environment without a redeploy.
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(24),
  WEBHOOK_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(1000),
  WEBHOOK_BACKOFF_CAP_MS: z.coerce.number().int().positive().default(3_600_000),
  // Per-request timeout on the HTTP POST to the subscriber (techspec: 10 s).
  WEBHOOK_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Retention window (days) applied by CleanupProcessor to WebhookDelivery
  // and WebhookDeliveryDLQ rows. Techspec: 30 days.
  WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // Rate limiting for the public API — sustained requests-per-minute per key,
  // with a small burst allowance to smooth over short spikes (PRD FR-15..18).
  RATE_LIMIT_DEFAULT_PER_MIN: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_BURST: z.coerce.number().int().nonnegative().default(50),

  // GitHub integration (Phase 10). OAuth client for the *integration* is
  // distinct from GITHUB_CLIENT_ID/SECRET (the sign-in identity provider) so
  // the two can be rotated independently. `GITHUB_APP_WEBHOOK_SECRET` protects
  // the internal inbound receiver at /api/internal/integrations/github/events.
  GITHUB_OAUTH_CLIENT_ID: z.string().default(''),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().default(''),
  GITHUB_APP_WEBHOOK_SECRET: z.string().default(''),

  // Google Calendar integration (Phase 10). Same split as GitHub — a dedicated
  // OAuth client isolates calendar scopes from sign-in scopes.
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(''),

  // Per-provider HTTP timeout for outbound integration calls (techspec: 15 s).
  INTEGRATION_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // Dedicated master keys for the AES-256-GCM vaults so they rotate
  // independently of JWT_SECRET. Empty → the vault derives its key from
  // JWT_SECRET (backwards compatible with pre-key deployments).
  WEBHOOK_MASTER_KEY: z.string().default(''),
  INTEGRATION_MASTER_KEY: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env);
}
