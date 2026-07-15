import { describe, it, expect } from 'vitest';
import { envSchema } from './env';

const validEnv = {
  NODE_ENV: 'development' as const,
  DATABASE_URL: 'postgres://tasker:tasker@localhost:5432/tasker',
  REDIS_URL: 'redis://localhost:6379',
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
});
