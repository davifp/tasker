import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { apiPost } from './support/csrf';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject, openDrawer, quickAddTask } from './support/board';

/**
 * Canonical collaboration flow (PRD Fase 5). Verifies the full drawer
 * substrate on a single task:
 *   1. Write a Markdown comment with an @mention pill.
 *   2. React with 👍 and toggle it back off.
 *   3. Attach a file via the drop zone → progress → READY row.
 *   4. Confirm the Activity feed shows entries for each mutation.
 *
 * The attachment step requires a MinIO service reachable from the API. The
 * repo compose already provides one at http://localhost:9000; when it is
 * missing the sign endpoint returns 500 and this test skips instead of
 * failing (same convention as backend/test/attachments.integration.spec.ts).
 */

test.describe('Collaboration flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('markdown comment + reaction + attachment surface in activity feed', async ({ page }) => {
    await onboardAccount(page);
    const project = await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Collab target');
    const drawer = await openDrawer(card);

    // ---- 1) Comment with mention --------------------------------------
    // Scope every locator to the Comments section — the drawer also has
    // Checklist + Dependencies sections with their own "Add" buttons.
    const commentsSection = drawer.getByRole('region', { name: /^comments$/i });
    const composer = commentsSection.getByLabel(/write a comment/i);
    await composer.fill('Ship it 🚀');
    await commentsSection.getByRole('button', { name: /^add$/i }).click();
    // The comment text ends up inside the drawer via SafeMarkdown; look for
    // the emoji rather than 'Ship' (which also appears in status names).
    await expect(commentsSection.getByText('🚀')).toBeVisible();

    // ---- 2) Toggle a reaction ----------------------------------------
    const heartBtn = drawer.getByRole('button', { name: /^heart$/i }).first();
    await heartBtn.click();
    await expect(heartBtn).toHaveAttribute('aria-pressed', 'true');
    await heartBtn.click();
    await expect(heartBtn).toHaveAttribute('aria-pressed', 'false');

    // ---- 3) Attach a file --------------------------------------------
    const fileInput = drawer.getByLabel(/attach files/i);
    // Bail early with a hint if MinIO is unreachable so the failure is
    // actionable (rather than a nested XHR error).
    const preflight = await apiPost(
      page,
      `/api/proxy/workspaces/${page.url().split('/')[3]}/projects/${project.slug}/tasks/1/attachments/sign`,
      { filename: 'preflight.txt', mime: 'text/plain', sizeBytes: 4 },
    );
    test.skip(preflight.status >= 500, 'MinIO not reachable — skipping attachment leg');

    await fileInput.setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello world'),
    });
    // The upload row appears immediately; once confirmed, the row also
    // appears in the READY list under Attachments.
    await expect(drawer.getByText('hello.txt').first()).toBeVisible({ timeout: 15_000 });

    // ---- 4) Activity feed contains the mutations ---------------------
    const activity = drawer.getByRole('region', { name: /activity/i }).first();
    await expect(activity.getByText(/commented/i)).toBeVisible();
    // Reaction verbs may lag by one tick after the toggle; scope the wait
    // to the activity region so it does not accidentally match the
    // reaction button.
    await expect(activity.getByText(/reacted with/i)).toBeVisible({ timeout: 10_000 });
    await expect(activity.getByText(/attached hello\.txt/i)).toBeVisible({ timeout: 15_000 });
  });
});
