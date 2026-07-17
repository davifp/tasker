import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = Number(process.env['WEB_PORT'] ?? 3000);
const API_PORT = Number(process.env['API_PORT'] ?? 3001);
const WEB_BASE_URL = process.env['E2E_WEB_URL'] ?? `http://localhost:${WEB_PORT}`;
const API_BASE_URL = process.env['E2E_API_URL'] ?? `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env['CI'] ? 'retain-on-failure' : 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter api start:dev',
      url: `${API_BASE_URL}/api/v1/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        OAUTH_SUCCESS_REDIRECT_URL: `${WEB_BASE_URL}/oauth/{provider}/complete`,
      },
    },
    {
      command: 'pnpm --filter web dev',
      url: WEB_BASE_URL,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: API_BASE_URL,
        INTERNAL_API_URL: API_BASE_URL,
        SESSION_COOKIE_SECRET: 'e2e-only-secret-please-change-me-0000000000',
      },
    },
  ],
});
