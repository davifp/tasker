import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';

/**
 * PRD Fase 6 dashboard flow: pick a project → burndown renders → hover
 * chart → definition popover shows lead-time text → `POST /dashboard/refresh`
 * → `asOf` timestamp updates.
 */

test.describe('Planning — dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('burndown, cycle/lead time popover, refresh updates asOf', async ({ page }) => {
    await onboardAccount(page);
    await page.goto('/workspace/dashboard');
    await expect(page.getByRole('heading', { name: /planning dashboard/i })).toBeVisible();
    // Deep interactions with the charts + refresh flow require a warmed
    // matview + Owner role plumbing that lands in a follow-up.
    test.fixme(true, 'Live burndown + refresh assertions land after seeding + role plumbing');
  });
});
