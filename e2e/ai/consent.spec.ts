import { test, expect } from '@playwright/test';
import { onboardAccount } from '../support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from '../support/mocks';
import { createProject, openDrawer, quickAddTask } from '../support/board';
import { stubAiConsentAccept, stubAiUsage } from '../support/ai';

// AI consent flow — the admin's acceptance flips the usage snapshot's
// `consent.accepted` bit, which in turn enables the AI actions dropdown.
// The spec drives the full round-trip: unenabled → "Accept and enable"
// button → re-fetch → menu becomes enabled.

test.describe('AI consent', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('admin accepts the AI consent → AI menu becomes enabled', async ({ page }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: false },
    });
    // After the acceptance POST, re-stub /ai/usage with accepted=true so the
    // TanStack Query invalidation from useAcceptAiConsent picks it up.
    await stubAiConsentAccept(page, account.workspaceSlug, async () => {
      await stubAiUsage(page, {
        workspaceSlug: account.workspaceSlug,
        consent: {
          accepted: true,
          acceptedDocumentVersion: 'v1',
          acceptedAt: new Date().toISOString(),
        },
      });
    });

    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Task with AI');
    const drawer = await openDrawer(card);

    // Banner surfaces the admin-side CTA.
    await expect(drawer.getByText(/Enable AI actions for this workspace/i)).toBeVisible();
    const menuButton = drawer.getByRole('button', { name: /^AI actions menu$/i });
    await expect(menuButton).toBeDisabled();

    await drawer.getByRole('button', { name: /Accept and enable/i }).click();

    // The banner clears and the AI menu unlocks after the usage refetch.
    await expect(drawer.getByText(/Enable AI actions for this workspace/i)).toBeHidden({
      timeout: 5000,
    });
    await expect(menuButton).toBeEnabled({ timeout: 5000 });
  });
});
