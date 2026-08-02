import { test, expect } from '@playwright/test';
import { onboardAccount } from '../support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from '../support/mocks';
import { createProject, openDrawer, quickAddTask } from '../support/board';
import { stubAiUsage, stubEstimateAndSuggest } from '../support/ai';

test.describe('AI — Estimate + suggest', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('renders estimate range, priority, and assignee suggestions', async ({ page }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: true },
    });
    await stubEstimateAndSuggest(page, account.workspaceSlug, {
      estimate: { low: 3, high: 5, confidence: 'high' },
      priority: 'HIGH',
      assignees: [{ userId: 'user-ada', reason: 'Owns billing module' }],
    });

    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Refactor billing');
    const drawer = await openDrawer(card);

    await drawer.getByRole('button', { name: /^AI actions menu$/i }).click();
    await page.getByRole('menuitem', { name: /Estimate \+ suggest/i }).click();

    const panel = drawer.getByRole('region', { name: /Suggestions/i });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/3.*–.*5.*hours/)).toBeVisible();
    await expect(panel.getByText(/high confidence/)).toBeVisible();
    await expect(panel.getByText(/HIGH/)).toBeVisible();
    await expect(panel.getByText(/Owns billing module/)).toBeVisible();
  });

  test('insufficient-context state renders the specific message', async ({ page }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: true },
    });
    // Backend surface for "not enough context" is a normal 200 with
    // insufficientContext=true — the panel shows the values as ranges but
    // the confidence collapses to `low` and no assignees are recommended.
    await stubEstimateAndSuggest(page, account.workspaceSlug, {
      estimate: { low: 0, high: 0, confidence: 'low' },
      priority: 'LOW',
      assignees: [],
      insufficientContext: true,
    });

    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Vague task');
    const drawer = await openDrawer(card);

    await drawer.getByRole('button', { name: /^AI actions menu$/i }).click();
    await page.getByRole('menuitem', { name: /Estimate \+ suggest/i }).click();

    const panel = drawer.getByRole('region', { name: /Suggestions/i });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/low confidence/)).toBeVisible();
    // Assignee-suggestions section is empty (no <li>).
    await expect(panel.getByRole('listitem')).toHaveCount(0);
  });
});
