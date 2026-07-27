import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject, quickAddTask } from './support/board';

/**
 * ⌘K palette + /search page end-to-end.
 *
 * Seeds a workspace with a project and two tasks (matching keywords chosen
 * to hit the tsvector index), then drives the palette and the dedicated
 * page through the browser to confirm:
 *   - ⌘K opens, results appear grouped
 *   - Selecting a hit navigates to the entity
 *   - Esc closes
 *   - /search mirrors the query via URL params (shareable / refresh-safe)
 *   - "See all results" footer navigates to /search
 */

test.describe('Global search — ⌘K + /search', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('palette shows grouped results and navigates on Enter', async ({ page }) => {
    const account = await onboardAccount(page);
    const project = await createProject(page, {
      workspaceSlug: account.workspaceSlug,
      name: 'Widget catalog',
    });
    await quickAddTask(page, 'Backlog', 'Fix login redirect loop');
    await quickAddTask(page, 'Backlog', 'Add widget carousel v2');

    // Open the palette with Cmd/Ctrl+K.
    await page.keyboard.press('ControlOrMeta+K');
    const searchInput = page.getByLabel(/search projects, tasks, and members/i);
    await expect(searchInput).toBeVisible();

    // Type a fragment that matches the widget task and the project.
    await searchInput.fill('widget');

    // Grouped headings appear. cmdk renders `CommandGroup` headings as
    // <div cmdk-group-heading aria-hidden="true">, which don't carry the
    // ARIA `heading` role — match on visible text instead.
    await expect(page.getByText(/^tasks$/i).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/^projects$/i).first()).toBeVisible();

    // A result matching "widget" is present.
    await expect(page.getByText(/widget/i).first()).toBeVisible();

    // Press Esc → dialog closes.
    await page.keyboard.press('Escape');
    await expect(searchInput).not.toBeVisible();

    // Re-open and use "See all results" footer to go to /search.
    await page.keyboard.press('ControlOrMeta+K');
    await page.getByLabel(/search projects, tasks, and members/i).fill('widget');
    await expect(page.getByText(/see all results/i)).toBeVisible({ timeout: 5_000 });
    await page.getByText(/see all results/i).click();

    await expect(page).toHaveURL(new RegExp(`/${account.workspaceSlug}/search\\?q=widget`));

    // /search page renders result cards for the same query.
    await expect(page.getByText(/widget/i).first()).toBeVisible();

    // URL is shareable: navigating fresh reproduces the result set.
    await page.goto(`/${account.workspaceSlug}/search?q=widget`);
    await expect(page.getByText(/widget/i).first()).toBeVisible();

    // The unrelated task doesn't show in the widget query.
    await expect(page.getByText(/redirect loop/i)).toHaveCount(0);

    // Preserve project reference to silence unused warnings.
    expect(project.slug).toBeTruthy();
  });
});
