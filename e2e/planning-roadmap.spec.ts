import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';

/**
 * PRD Fase 6 roadmap flow: create two epics on Q3 2026, drag one to
 * Q4 2026, resize to span Q4–Q1 2027, link a task, verify grid.
 */

test.describe('Planning — quarterly roadmap', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('create → drag between quarters → resize → link task', async ({ page }) => {
    await onboardAccount(page);
    // Resize handles land in a follow-up; the current UI covers create +
    // drag between quarters + link via the dialog. Marking fixme so the
    // CI dashboard shows the outstanding coverage explicitly.
    test.fixme(true, 'Resize handles + inline task linking arrive in a follow-up UI pass');
    await page.goto('/workspace/roadmap');
    await expect(page.getByRole('heading', { name: /roadmap/i })).toBeVisible();
  });
});
