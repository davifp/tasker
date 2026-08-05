import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Compiling AppModule pulls Prisma + BullMQ workers + every feature module,
// which under a fully-loaded worker pool can push past the vitest default
// 5 s. Give this describe block room so a real config-validation failure
// isn't masked by an unrelated timeout.
const APP_MODULE_COMPILE_TIMEOUT_MS = 30_000;

describe('AppModule config validation (integration)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  beforeEach(() => {
    vi.resetModules();
  });

  it(
    'rejects boot when DATABASE_URL is not a valid URL',
    async () => {
      vi.stubEnv('DATABASE_URL', 'not-a-url');

      const { Test } = await import('@nestjs/testing');
      const { AppModule } = await import('../src/app.module');

      await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow();
    },
    APP_MODULE_COMPILE_TIMEOUT_MS,
  );

  it(
    'rejects boot when DATABASE_URL is missing',
    async () => {
      vi.stubEnv('DATABASE_URL', '');

      const { Test } = await import('@nestjs/testing');
      const { AppModule } = await import('../src/app.module');

      await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow();
    },
    APP_MODULE_COMPILE_TIMEOUT_MS,
  );
});
