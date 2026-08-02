import { test, expect } from '@playwright/test';
import { onboardAccount } from '../support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from '../support/mocks';
import { createProject, openDrawer, quickAddTask } from '../support/board';
import { stubAiSse, stubAiUsage } from '../support/ai';

test.describe('AI — Budget exhausted', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('AI menu disabled + reason surfaced, no SSE request fires', async ({ page }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: true },
      tokensBudget: 1000,
      tokensConsumed: 1000,
    });

    // Any SSE call would be an assertion failure — record a hit if it ever happens.
    let sseCalled = false;
    await stubAiSse(page, account.workspaceSlug, /\/ai\/tasks\/[^/]+\/generate-description$/, {
      frames: [{ event: 'message', data: 'SHOULD NOT SEE THIS' }],
    });
    await page.route(
      /\/api\/proxy\/workspaces\/[^/]+\/ai\/tasks\/[^/]+\/generate-description$/,
      (route) => {
        sseCalled = true;
        route.fallback();
      },
    );

    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Cannot AI');
    const drawer = await openDrawer(card);

    // Red "limit reached" alert.
    const alert = drawer.getByRole('alert');
    await expect(alert).toContainText(/Monthly limit reached/i);

    // Menu button is disabled.
    const menuButton = drawer.getByRole('button', { name: /^AI actions menu$/i });
    await expect(menuButton).toBeDisabled();

    // No SSE call was made (menu wasn't openable).
    expect(sseCalled).toBe(false);
  });

  test('mid-stream budget exhausted problem surfaces the specific error copy', async ({ page }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: true },
      // Not exhausted yet in the snapshot; the SSE endpoint itself fails.
      tokensBudget: 1000,
      tokensConsumed: 500,
    });
    await stubAiSse(page, account.workspaceSlug, /\/ai\/tasks\/[^/]+\/generate-description$/, {
      problem: {
        type: 'about:blank#ai-budget-exhausted',
        title: 'Budget exhausted',
        status: 429,
        detail: 'Monthly token budget reached.',
      },
    });

    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Streaming will fail');
    const drawer = await openDrawer(card);

    await drawer.getByRole('button', { name: /^AI actions menu$/i }).click();
    await page.getByRole('menuitem', { name: /Generate description/i }).click();

    // The friendly copy for `ai-budget-exhausted` is specific.
    await expect(drawer.getByText(/This workspace has reached its monthly AI budget/i)).toBeVisible(
      { timeout: 5000 },
    );
  });
});
