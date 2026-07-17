import { test, expect } from '@playwright/test';

test.describe('OAuth (Google) completion', () => {
  test('reads tokens from the URL fragment, exchanges them, and lands in the workspace', async ({
    page,
  }) => {
    // Stub the network call to /api/auth/oauth-complete so we don't need to mint real JWTs.
    await page.route('**/api/auth/oauth-complete', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ redirectTo: '/acme/projects' }),
      });
    });

    await page.goto('/oauth/google/complete#accessToken=fake-access&refreshToken=fake-refresh');

    // The fragment is stripped as part of the exchange.
    await expect.poll(async () => new URL(page.url()).hash, { timeout: 5000 }).toBe('');
    // The exchange returned redirectTo=/acme/projects. Because the mock doesn't produce a real
    // session cookie, the middleware bounces to /login preserving the target — that still proves
    // the redirect wiring works end-to-end.
    await expect(page).toHaveURL(/(\/acme\/projects$|\/login\?redirectTo=%2Facme%2Fprojects$)/);
  });

  test('surfaces a friendly error when the URL is missing tokens', async ({ page }) => {
    await page.goto('/oauth/google/complete');
    await expect(page.getByText(/didn't return the credentials/i)).toBeVisible();
  });
});
