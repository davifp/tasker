import { test, expect } from '@playwright/test';
import { onboardAccount } from '../support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from '../support/mocks';
import { createProject, openDrawer, quickAddTask } from '../support/board';
import { stubAiFeedback, stubAiUsage, stubEstimateAndSuggest } from '../support/ai';

test.describe('AI — Feedback widget', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('👍 posts a POSITIVE feedback for the correct invocation', async ({ page }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: true },
    });
    await stubEstimateAndSuggest(page, account.workspaceSlug, {
      invocationId: 'inv-feedback-1',
      estimate: { low: 1, high: 2, confidence: 'medium' },
      priority: 'LOW',
      assignees: [],
    });
    const submissions = stubAiFeedback(page, account.workspaceSlug);

    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Feedback target');
    const drawer = await openDrawer(card);

    await drawer.getByRole('button', { name: /^AI actions menu$/i }).click();
    await page.getByRole('menuitem', { name: /Estimate \+ suggest/i }).click();

    const panel = drawer.getByRole('region', { name: /Suggestions/i });
    await panel.getByRole('button', { name: /Rate this AI response positively/i }).click();

    // The widget swaps to a confirmation state and stops showing the buttons.
    await expect(panel.getByText(/Thanks for the feedback/i)).toBeVisible({ timeout: 3000 });
    await expect(
      panel.getByRole('button', { name: /Rate this AI response positively/i }),
    ).toHaveCount(0);

    // Exactly one POST was made with the expected payload.
    expect(submissions).toEqual([{ invocationId: 'inv-feedback-1', rating: 'POSITIVE' }]);
  });

  test('👎 opens a reason textarea; the reason is included in the POST', async ({ page }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: true },
    });
    await stubEstimateAndSuggest(page, account.workspaceSlug, {
      invocationId: 'inv-feedback-neg',
    });
    const submissions = stubAiFeedback(page, account.workspaceSlug);

    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Negative feedback');
    const drawer = await openDrawer(card);

    await drawer.getByRole('button', { name: /^AI actions menu$/i }).click();
    await page.getByRole('menuitem', { name: /Estimate \+ suggest/i }).click();

    const panel = drawer.getByRole('region', { name: /Suggestions/i });
    await panel.getByRole('button', { name: /Rate this AI response negatively/i }).click();

    const reason = panel.getByRole('textbox', { name: /What was wrong/i });
    await expect(reason).toBeVisible();
    await reason.fill('The estimate range was wildly off.');
    await panel.getByRole('button', { name: /Send feedback/i }).click();

    await expect(panel.getByText(/Thanks for the feedback/i)).toBeVisible({ timeout: 3000 });
    expect(submissions).toEqual([
      {
        invocationId: 'inv-feedback-neg',
        rating: 'NEGATIVE',
        reason: 'The estimate range was wildly off.',
      },
    ]);
  });
});
