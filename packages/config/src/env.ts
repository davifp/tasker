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
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env);
}
