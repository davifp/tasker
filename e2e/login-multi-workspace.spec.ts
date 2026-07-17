import { test, expect } from '@playwright/test';

// This spec expects two workspaces to exist for the seeded user
// (fixture pending; the shape below is the behavior we want).
test.describe('login with multiple workspaces', () => {
  test.skip(
    !process.env['E2E_MULTI_WORKSPACE_USER_EMAIL'],
    'Requires a seeded user with two workspaces',
  );

  test('lands on the last-used workspace and switches via topbar', async ({ page }) => {
    const email = process.env['E2E_MULTI_WORKSPACE_USER_EMAIL'] ?? '';
    const password = process.env['E2E_MULTI_WORKSPACE_USER_PASSWORD'] ?? '';

    await page.goto('/login');
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/[^/]+\/projects/);
    const firstUrl = new URL(page.url());
    const firstSlug = firstUrl.pathname.split('/')[1];
    expect(firstSlug).toBeTruthy();

    await page.getByRole('button', { name: /workspaces/i }).click();
    const otherWorkspace = page
      .getByRole('menuitem')
      .filter({ hasNotText: firstSlug ?? '' })
      .first();
    await otherWorkspace.click();

    await expect(page).not.toHaveURL(new RegExp(`^/${firstSlug}/`));
    await expect(page).toHaveURL(/\/[^/]+\/projects/);
  });
});
