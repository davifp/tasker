import { test, expect } from '@playwright/test';
import { onboardAccount } from '../support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from '../support/mocks';
import { createProject, openDrawer, quickAddTask } from '../support/board';
import { stubAiSse, stubAiUsage } from '../support/ai';

test.describe('AI — Generate description', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('streams tokens → user clicks Use → description saves', async ({ page }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: true, acceptedDocumentVersion: 'v1' },
    });
    await stubAiSse(page, account.workspaceSlug, /\/ai\/tasks\/[^/]+\/generate-description$/, {
      frames: [
        { event: 'message', data: '## Goal\n\n' },
        { event: 'message', data: 'Ship the landing page.' },
      ],
    });

    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Landing page');
    const drawer = await openDrawer(card);

    // Open the AI menu → pick "Generate description".
    await drawer.getByRole('button', { name: /^AI actions menu$/i }).click();
    await page.getByRole('menuitem', { name: /Generate description/i }).click();

    const pendingPanel = drawer.getByRole('region', { name: /Generated description/i });
    await expect(pendingPanel).toBeVisible();
    // AI badge is always present on AI-rendered content.
    await expect(pendingPanel.getByRole('note', { name: /ai-generated/i })).toBeVisible();
    // Streamed content lands in the panel.
    await expect(pendingPanel.getByText(/Ship the landing page/)).toBeVisible({ timeout: 5000 });

    // Accept — the editor opens with the streamed content pre-filled.
    await pendingPanel.getByRole('button', { name: /^Use$/ }).click();
    const editor = drawer.getByRole('textbox', { name: /description/i });
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(/Ship the landing page/);

    // Save → the pending panel closes and the description renders on-drawer.
    await drawer.getByRole('button', { name: /^save$/i }).click();
    await expect(drawer.getByText(/Ship the landing page/)).toBeVisible({ timeout: 5000 });
  });
});
