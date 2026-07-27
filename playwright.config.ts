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
      // 1600×900 fits the full Kanban board (sidebar + 5 × 280px columns +
      // gaps) inside the viewport so mouse drags can reach every column
      // without needing to trigger horizontal scroll mid-drag. `Desktop
      // Chrome` (1280×720) leaves ~ 400px of Kanban clipped to the right.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter api dev',
      url: `${API_BASE_URL}/api/v1/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        OAUTH_SUCCESS_REDIRECT_URL: `${WEB_BASE_URL}/oauth/{provider}/complete`,
        // Pin the SMTP transport at MailHog so every environment (local dev,
        // CI runner) delivers verification mails to the same inbox the
        // `waitForEmail` helper polls. Defaults already point at localhost:1025
        // but declaring them here prevents silent drift.
        SMTP_HOST: process.env['SMTP_HOST'] ?? 'localhost',
        SMTP_PORT: process.env['SMTP_PORT'] ?? '1025',
        SMTP_FROM: process.env['SMTP_FROM'] ?? '"Tasker E2E" <e2e@tasker.local>',
        // Relax auth-endpoint throttling for the e2e run — each spec
        // registers a fresh user through `/api/v1/auth/register` and the
        // production 5-per-window limit would fail the suite. Dedicated
        // throttler coverage lives in the auth spec (Task 4.0), not here.
        THROTTLE_REGISTER_LIMIT: '1000',
        THROTTLE_REGISTER_TTL_S: '60',
        THROTTLE_LOGIN_LIMIT: '1000',
        THROTTLE_LOGIN_TTL_S: '60',
        THROTTLE_REFRESH_LIMIT: '1000',
        THROTTLE_REFRESH_TTL_S: '60',
        THROTTLE_EMAIL_RESEND_LIMIT: '1000',
        THROTTLE_EMAIL_RESEND_TTL_S: '60',
        THROTTLE_PASSWORD_RESET_LIMIT: '1000',
        THROTTLE_PASSWORD_RESET_TTL_S: '60',
        // Lift the global default throttler. The 500-task seed fixture in
        // `e2e/views.spec.ts` creates > 500 rows through POST /tasks within
        // the same window; the production 100/60s default would trip long
        // before the fixture reaches steady state and mask the real assertions
        // under a throttler failure.
        THROTTLE_DEFAULT_LIMIT: '10000',
        THROTTLE_DEFAULT_TTL_S: '60',
        // Notification email batcher: default 5-minute window is far too
        // wide for the mention-notification spec, which asserts on a
        // MailHog message inside a single test's lifetime. Collapse it to
        // 5 s so the drain job fires before the spec's timeout.
        NOTIF_EMAIL_BATCH_WINDOW_S: '5',
        // Web Push VAPID key pair — placeholder, not a real cryptographic
        // key. The push-optin spec stubs navigator.serviceWorker so no
        // outbound push ever happens; the frontend hook just needs
        // `getVapidKey()` to return a non-null base64-url string so
        // pushManager.subscribe is reached.
        VAPID_PUBLIC_KEY:
          process.env['VAPID_PUBLIC_KEY'] ??
          'BJT0R8s3d1JbA4hZ_dY3Iis9EBcNRPqM8Nhy0kQ1_g8s3d1JbA4hZ_dY3Iis9EBcNRPqM8Nhy0kQ1_g8s',
        VAPID_PRIVATE_KEY:
          process.env['VAPID_PRIVATE_KEY'] ?? 'e2e-placeholder-private-key-not-used',
        VAPID_SUBJECT: process.env['VAPID_SUBJECT'] ?? 'mailto:e2e@tasker.local',
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
