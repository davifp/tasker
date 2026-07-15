import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('AppModule config validation (integration)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects boot when DATABASE_URL is not a valid URL', async () => {
    vi.stubEnv('DATABASE_URL', 'not-a-url');

    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../src/app.module');

    await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow();
  });

  it('rejects boot when DATABASE_URL is missing', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../src/app.module');

    await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow();
  });
});
