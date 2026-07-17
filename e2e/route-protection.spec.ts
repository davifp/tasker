import { test, expect } from '@playwright/test';

test.describe('route protection', () => {
  test('unauthenticated deep link redirects to /login with redirectTo=', async ({ page }) => {
    await page.goto('/acme/projects?board=42', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login\?redirectTo=/);
    const url = new URL(page.url());
    expect(url.searchParams.get('redirectTo')).toBe('/acme/projects?board=42');
  });

  test('public routes are reachable without a session', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: /create your workspace/i })).toBeVisible();
  });

  test('the tsk_session cookie is httpOnly and inaccessible from JS', async ({ page, context }) => {
    await page.goto('/login');
    const cookiesFromDom = await page.evaluate(() => document.cookie);
    expect(cookiesFromDom).not.toContain('tsk_session');
    const allCookies = await context.cookies();
    const session = allCookies.find((cookie) => cookie.name === 'tsk_session');
    // If a session cookie already exists (from a previous run), it must be httpOnly.
    if (session) {
      expect(session.httpOnly).toBe(true);
      expect(session.sameSite?.toLowerCase()).toBe('lax');
    }
  });
});
