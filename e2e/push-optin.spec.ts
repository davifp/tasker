import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { stubWebPush } from './support/realtime';

// Opting into web push is a browser-only flow. We can't drive Chromium's
// real push service in CI (it needs an FCM endpoint reachable from the
// runner and a real VAPID key pair). Instead, we stub Notification.permission
// and navigator.serviceWorker inside the page context — the app's push
// toggle then walks through its real sequence (VAPID fetch → subscribe →
// POST /push/subscriptions), reaches the backend, and the row lands in
// PushSubscription. The DELETE leg unsubscribes by endpoint. No GET on the
// controller today, so we assert on the request/response life cycle rather
// than reading the table back.
test.describe('Push opt-in', () => {
  test.beforeEach(async ({ page, context }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
    await stubWebPush(context);
  });

  test('enable POSTs a subscription; disable DELETEs it', async ({ page }) => {
    const owner = await onboardAccount(page);
    await page.goto(`/${owner.workspaceSlug}/settings/notifications`);

    const enableBtn = page.getByRole('button', { name: /enable.*push/i });
    await expect(enableBtn).toBeVisible();

    // ---- Enable: expect a POST to /push/subscriptions --------------------
    const subscribeResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/push/subscriptions') &&
        res.request().method() === 'POST' &&
        res.status() === 201,
    );
    await enableBtn.click();
    const created = await subscribeResponse;
    const body = (await created.json()) as { endpoint?: string };
    expect(body.endpoint).toContain('push.example.test');
    await expect(page.getByRole('button', { name: /disable.*push/i })).toBeVisible({
      timeout: 10_000,
    });

    // ---- Disable: expect a DELETE keyed by the endpoint ------------------
    const unsubscribeResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/push/subscriptions/') &&
        res.request().method() === 'DELETE' &&
        res.status() === 204,
    );
    await page.getByRole('button', { name: /disable.*push/i }).click();
    await unsubscribeResponse;
    await expect(page.getByRole('button', { name: /enable.*push/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});
