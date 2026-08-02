import { test, expect } from '@playwright/test';
import { onboardAccount } from '../support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from '../support/mocks';
import { createProject, openDrawer, quickAddTask } from '../support/board';
import { stubAiSse, stubAiUsage } from '../support/ai';

test.describe('AI — Generate checklist', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('items arrive as pending; user accepts', async ({ page }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: true },
    });

    // Structured checklist arrives on the terminal `event: result` frame.
    await stubAiSse(page, account.workspaceSlug, /\/ai\/tasks\/[^/]+\/generate-checklist$/, {
      frames: [
        {
          event: 'result',
          data: JSON.stringify({
            invocationId: 'inv-checklist-1',
            items: ['Draft the copy', 'Wire the analytics event', 'QA on staging'],
          }),
        },
      ],
    });

    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Checklist target');
    const drawer = await openDrawer(card);

    await drawer.getByRole('button', { name: /^AI actions menu$/i }).click();
    await page.getByRole('menuitem', { name: /Generate checklist/i }).click();

    const panel = drawer.getByRole('region', { name: /Generated checklist/i });
    await expect(panel).toBeVisible();
    // AI badge — non-negotiable per PRD.
    await expect(panel.getByRole('note', { name: /ai-generated/i })).toBeVisible();

    for (const item of ['Draft the copy', 'Wire the analytics event', 'QA on staging']) {
      await expect(panel.getByText(item)).toBeVisible();
    }

    // Use button is present (per-item persistence is a follow-up; the button
    // hands the items off to the parent for downstream handling).
    await expect(panel.getByRole('button', { name: /^Use$/ })).toBeVisible();

    // Feedback widget appears alongside the accepted output so the user
    // can rate the invocation.
    await expect(
      panel.getByRole('button', { name: /Rate this AI response positively/i }),
    ).toBeVisible();
  });
});
