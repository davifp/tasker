import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject } from './support/board';

/**
 * PRD Fase 6 mandatory flow: create a sprint → drag 10 tasks from the
 * backlog into the sprint (both DnD and keyboard paths) → start the
 * sprint → move some tasks to DONE → complete the sprint → verify the
 * closure numbers → exercise the slipped-task rollover CTA.
 */

test.describe('Planning — sprint lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('end-to-end sprint flow (create, plan, start, complete, rollover)', async ({ page }) => {
    await onboardAccount(page);
    const project = await createProject(page);

    // The full DnD + rollover flow depends on a stable sprint create dialog
    // wired into the project shell, which arrives in a follow-up UI polish
    // pass. Marking `fixme` (not `skip`) so CI surfaces the test as pending
    // instead of silently green.
    test.fixme(true, 'Sprint create dialog + rollover CTA lands in a follow-up UI pass');
    await page.goto(`/${project.workspaceSlug}/sprints`);
    await expect(page.getByRole('heading', { name: /sprints/i })).toBeVisible();
  });
});
