import { describe, it, expect } from 'vitest';
import { envSchema } from './env';

const validEnv = {
  NODE_ENV: 'development' as const,
  DATABASE_URL: 'postgres://tasker:tasker@localhost:5432/tasker',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(64),
  RT_TICKET_SECRET: 'b'.repeat(64),
};

describe('envSchema', () => {
  it('accepts a valid environment', () => {
    const result = envSchema.parse(validEnv);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3001);
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('applies PORT default when omitted', () => {
    const result = envSchema.parse(validEnv);
    expect(result.PORT).toBe(3001);
  });

  it('applies LOG_LEVEL default when omitted', () => {
    const result = envSchema.parse(validEnv);
    expect(result.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from string to number', () => {
    const result = envSchema.parse({ ...validEnv, PORT: '4000' });
    expect(result.PORT).toBe(4000);
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => envSchema.parse({ ...validEnv, DATABASE_URL: undefined })).toThrow();
  });

  it('rejects missing REDIS_URL', () => {
    expect(() => envSchema.parse({ ...validEnv, REDIS_URL: undefined })).toThrow();
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() => envSchema.parse({ ...validEnv, NODE_ENV: 'staging' })).toThrow();
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() => envSchema.parse({ ...validEnv, LOG_LEVEL: 'verbose' })).toThrow();
  });

  it('rejects non-URL DATABASE_URL', () => {
    expect(() => envSchema.parse({ ...validEnv, DATABASE_URL: 'not-a-url' })).toThrow();
  });

  // Regression: without env-driven overrides for the default throttler,
  // E2E fixtures that write > 100 rows in one minute are silently rate-limited
  // and mask real assertions under a throttler failure. See bugs.md BUG-01/02.
  it('applies default throttler defaults matching production (100/60s)', () => {
    const result = envSchema.parse(validEnv);
    expect(result.THROTTLE_DEFAULT_LIMIT).toBe(100);
    expect(result.THROTTLE_DEFAULT_TTL_S).toBe(60);
  });

  it('coerces THROTTLE_DEFAULT_LIMIT + TTL from strings so playwright env can override them', () => {
    const result = envSchema.parse({
      ...validEnv,
      THROTTLE_DEFAULT_LIMIT: '10000',
      THROTTLE_DEFAULT_TTL_S: '60',
    });
    expect(result.THROTTLE_DEFAULT_LIMIT).toBe(10_000);
    expect(result.THROTTLE_DEFAULT_TTL_S).toBe(60);
  });

  // Phase 8: realtime & notifications env vars.
  it('applies realtime defaults (60s ticket TTL, localhost origin)', () => {
    const result = envSchema.parse(validEnv);
    expect(result.RT_TICKET_TTL_S).toBe(60);
    expect(result.RT_ALLOWED_ORIGINS).toBe('http://localhost:3000');
  });

  it('rejects a RT_TICKET_SECRET shorter than 32 chars', () => {
    expect(() => envSchema.parse({ ...validEnv, RT_TICKET_SECRET: 'too-short' })).toThrow();
  });

  it('coerces RT_TICKET_TTL_S from string and rejects a non-positive value', () => {
    const result = envSchema.parse({ ...validEnv, RT_TICKET_TTL_S: '120' });
    expect(result.RT_TICKET_TTL_S).toBe(120);
    expect(() => envSchema.parse({ ...validEnv, RT_TICKET_TTL_S: '0' })).toThrow();
  });

  it('applies notification timing defaults (300s batch, 60s dedupe)', () => {
    const result = envSchema.parse(validEnv);
    expect(result.NOTIF_EMAIL_BATCH_WINDOW_S).toBe(300);
    expect(result.NOTIF_DEDUPE_WINDOW_S).toBe(60);
  });

  it('coerces NOTIF_EMAIL_BATCH_WINDOW_S from string', () => {
    const result = envSchema.parse({ ...validEnv, NOTIF_EMAIL_BATCH_WINDOW_S: '120' });
    expect(result.NOTIF_EMAIL_BATCH_WINDOW_S).toBe(120);
  });

  it('applies VAPID defaults (empty keys, sender subject)', () => {
    const result = envSchema.parse(validEnv);
    expect(result.VAPID_PUBLIC_KEY).toBe('');
    expect(result.VAPID_PRIVATE_KEY).toBe('');
    expect(result.VAPID_SUBJECT).toBe('mailto:noreply@tasker.dev');
  });
});
