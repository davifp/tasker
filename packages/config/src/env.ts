import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),

  // Sessions
  SESSION_TTL_DAYS: z.coerce.number().default(30),

  // Throttler (auth endpoints)
  THROTTLE_REGISTER_LIMIT: z.coerce.number().default(5),
  THROTTLE_REGISTER_TTL_S: z.coerce.number().default(60),
  THROTTLE_LOGIN_LIMIT: z.coerce.number().default(5),
  THROTTLE_LOGIN_TTL_S: z.coerce.number().default(60),
  THROTTLE_REFRESH_LIMIT: z.coerce.number().default(20),
  THROTTLE_REFRESH_TTL_S: z.coerce.number().default(60),
});

export type Env = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env);
}
