import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';

// PRD Fase 6 roadmap surface. The board renders the current fiscal
// year + 4 look-ahead quarters and the "+ New epic" dialog. The
// workspace-level route does not carry a project scope yet, so the
// create button collects the fields but a workspace picker will land
// with the unified `getWorkspaceSession()` follow-up. We assert on the
// read-only surface that ships today.

test.describe('Planning — quarterly roadmap', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('renders the fiscal quarter grid with empty state', async ({ page }) => {
    const account = await onboardAccount(page);

    await page.goto(`/${account.workspaceSlug}/roadmap`);

    await expect(page.getByRole('heading', { level: 1, name: /^roadmap$/i })).toBeVisible();
    // 5 quarter columns: current + next 4. Assert the header row shows
    // exactly 5 `YYYY-Q[1-4]` labels.
    const headers = page.locator('text=/\\b\\d{4}-Q[1-4]\\b/');
    await expect(headers).toHaveCount(5, { timeout: 5_000 });

    await expect(page.getByText(/no epics in this window/i)).toBeVisible();
    // The affordance renders regardless of role — clicking it opens the
    // dialog, but submitting from `/roadmap` today would fail without a
    // project scope, so we stop at the affordance visibility check.
    await expect(page.getByRole('button', { name: /new epic/i })).toBeVisible();
  });
});
