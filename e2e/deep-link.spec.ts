import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject, quickAddTask } from './support/board';

test.describe('Deep link — direct task URL', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('direct nav opens the drawer with focus on title; missing task renders the fallback', async ({
    page,
  }) => {
    const account = await onboardAccount(page);
    const project = await createProject(page);
    await quickAddTask(page, 'To do', 'Deep-linked task');

    // Happy path — direct nav to /tasks/1.
    await page.goto(`/${account.workspaceSlug}/projects/${project.slug}/tasks/1`);
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    // Target by accessible name — the drawer contains multiple textareas
    // (description, comment editor); a positional `first()` is brittle.
    const titleField = drawer.getByRole('textbox', { name: /task title/i });
    await expect(titleField).toBeFocused();
    await expect(titleField).toHaveValue(/Deep-linked task/);

    // Not-found path — direct nav to a non-existent number.
    await page.goto(`/${account.workspaceSlug}/projects/${project.slug}/tasks/9999`);
    // Next.js mounts a hidden route announcer with role="alert"; scope to
    // the heading text so we match the TaskNotFound fallback specifically.
    await expect(page.getByRole('heading', { name: /task not found/i })).toBeVisible();
    const backLink = page.getByRole('link', { name: /back to board/i });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL(new RegExp(`/${project.slug}/board$`));
  });
});
