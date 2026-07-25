import { test, expect } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject, openDrawer, quickAddTask } from './support/board';

/**
 * Attachment policy limits exercised end-to-end (PRD FR-19).
 *
 * The client rejects oversized + disallowed-mime files before any HTTP
 * traffic hits the API, so these two tests are safe to run without MinIO.
 */

test.describe('Attachments — policy limits', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('rejects a >25 MB file client-side without hitting the API', async ({ page }) => {
    await onboardAccount(page);
    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Attachment gate');
    const drawer = await openDrawer(page, card);

    let signCalls = 0;
    await page.route('**/attachments/sign', (route) => {
      signCalls++;
      return route.continue();
    });

    // 26 MB — exceeds ATTACHMENT_MAX_BYTES (25 MB). The rejection surfaces
    // as a "too large" tag inside the upload row.
    await drawer.getByLabel(/attach files/i).setInputFiles({
      name: 'giant.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(26 * 1024 * 1024, 0x2a),
    });

    await expect(drawer.getByText(/larger than the 25 mb limit/i)).toBeVisible();
    expect(signCalls).toBe(0);
  });

  test('rejects a disallowed mime type client-side', async ({ page }) => {
    await onboardAccount(page);
    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Mime gate');
    const drawer = await openDrawer(page, card);

    let signCalls = 0;
    await page.route('**/attachments/sign', (route) => {
      signCalls++;
      return route.continue();
    });

    await drawer.getByLabel(/attach files/i).setInputFiles({
      name: 'malware.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('MZ'),
    });

    await expect(drawer.getByText(/file type is not allowed/i)).toBeVisible();
    expect(signCalls).toBe(0);
  });
});
