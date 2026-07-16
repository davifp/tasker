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

  // BullMQ health thresholds (report degraded above these).
  BULLMQ_HEALTH_MAX_WAITING: z.coerce.number().default(1000),
  BULLMQ_HEALTH_MAX_STALLED: z.coerce.number().default(10),
  // Max time to wait for BullMQ queue introspection before reporting degraded
  // (protects /health from hanging when Redis is unreachable).
  BULLMQ_HEALTH_TIMEOUT_MS: z.coerce.number().default(2000),
  // Max time to wait for the cleanup repeatable-job registration at boot
  // (protects app.listen from blocking when Redis is unreachable).
  CLEANUP_REGISTER_TIMEOUT_MS: z.coerce.number().default(2000),
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env);
}
