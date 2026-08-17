import { test, expect, type Page } from '@playwright/test';

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

  test.describe('stale iron-session cookie (BUG-15 regression)', () => {
    async function plantStaleSession(page: Page): Promise<void> {
      const response = await page.request.get('/api/session/plant-stale');
      expect(response.ok(), 'plant-stale helper must succeed in non-prod').toBe(true);
    }

    test('/ with stale cookie lands on /login (no infinite redirect)', async ({
      page,
      context,
    }) => {
      await plantStaleSession(page);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login(\?|$)/);
      await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
      const cookies = await context.cookies();
      expect(cookies.find((cookie) => cookie.name === 'tsk_session')).toBeUndefined();
    });

    test('/login with stale cookie renders the form (does not bounce to /)', async ({
      page,
      context,
    }) => {
      await plantStaleSession(page);
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login(\?|$)/);
      await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
      const cookies = await context.cookies();
      expect(cookies.find((cookie) => cookie.name === 'tsk_session')).toBeUndefined();
    });

    test('protected deep link with stale cookie ends on /login (no loop)', async ({
      page,
      context,
    }) => {
      await plantStaleSession(page);
      await page.goto('/orbital-labs/dashboard', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login(\?|$)/);
      const cookies = await context.cookies();
      expect(cookies.find((cookie) => cookie.name === 'tsk_session')).toBeUndefined();
    });
  });
});
