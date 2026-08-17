import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { apiPatch } from './support/csrf';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { columnRegion, createProject, quickAddTask } from './support/board';

test.describe('Board filters — URL as source of truth', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('apply assignee=me → URL reflects; hard reload preserves; clear restores', async ({
    page,
  }) => {
    const account = await onboardAccount(page);
    const project = await createProject(page);
    await quickAddTask(page, 'To do', 'Ship it');
    await quickAddTask(page, 'To do', 'Fix it');

    // Assign "Ship it" (task 1) to the current user so `assignee=me` has a
    // semantic effect — without this, both seeded tasks are unassigned and
    // the filter appears to work while actually hiding everything.
    const meResponse = await page.request.get('/api/proxy/me');
    const me = (await meResponse.json()) as { id: string };
    const patchResponse = await apiPatch(
      page,
      `/api/proxy/workspaces/${account.workspaceSlug}/projects/${project.slug}/tasks/1`,
      { assigneeUserId: me.id },
    );
    expect(patchResponse.ok).toBe(true);
    await page.reload();

    const todo = columnRegion(page, 'To do');
    const shipCard = todo.getByRole('button', { name: /open task #\d+: Ship it/i });
    const fixCard = todo.getByRole('button', { name: /open task #\d+: Fix it/i });

    // Baseline — both cards render.
    await expect(shipCard).toBeVisible();
    await expect(fixCard).toBeVisible();

    // Open assignee dropdown, pick "Assigned to me".
    await page.getByRole('button', { name: /filter by assignee/i }).click();
    await page.getByRole('menuitem', { name: /assigned to me/i }).click();

    // URL reflects the change.
    await expect.poll(() => page.url()).toContain('assignee=me');
    await expect(page.getByRole('button', { name: /clear assignee filter/i })).toBeVisible();

    // Filter *actually* hides the unassigned card.
    await expect(shipCard).toBeVisible();
    await expect(fixCard).toBeHidden();

    // Hard reload preserves both the URL and the filtered board state.
    await page.reload();
    expect(page.url()).toContain('assignee=me');
    await expect(page.getByRole('button', { name: /clear assignee filter/i })).toBeVisible();
    await expect(shipCard).toBeVisible();
    await expect(fixCard).toBeHidden();

    // Clear all → URL drops the filter keys, both cards return.
    await page.getByRole('button', { name: /clear filters/i }).click();
    await expect.poll(() => page.url()).not.toContain('assignee=');
    await expect(page.getByRole('button', { name: /clear assignee filter/i })).toBeHidden();
    await expect(shipCard).toBeVisible();
    await expect(fixCard).toBeVisible();
  });
});
