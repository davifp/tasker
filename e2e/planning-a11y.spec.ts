import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { onboardAccount, type OnboardedAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';

// PRD Fase 6 a11y sweep. Runs axe on each planning route with the
// WCAG 2.0 A/AA + 2.1 AA tagsets and fails the run on serious/critical
// violations. Keyboard sprint planning is exercised in the sprint spec
// once the backlog↔sprint drag surface is wired end-to-end.

test.describe('Planning — accessibility', () => {
  let account: OnboardedAccount;

  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
    account = await onboardAccount(page);
  });

  const routes = [
    { name: 'sprints', suffix: 'sprints' },
    { name: 'roadmap', suffix: 'roadmap' },
    { name: 'dashboard', suffix: 'dashboard' },
  ];

  for (const route of routes) {
    test(`${route.name} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(`/${account.workspaceSlug}/${route.suffix}`);
      // Wait for the primary heading so axe scans a settled DOM instead
      // of the initial RSC placeholder frame.
      await expect(page.locator('h1').first()).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});
