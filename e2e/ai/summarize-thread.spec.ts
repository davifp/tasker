import { test, expect, type Page } from '@playwright/test';
import { onboardAccount } from '../support/auth';
import { apiPost } from '../support/csrf';
import { mockExternalIntegrations, pinEnglishLocale } from '../support/mocks';
import { createProject, openDrawer, quickAddTask } from '../support/board';
import { stubAiSse, stubAiUsage } from '../support/ai';

// The "Summarize discussion" button MUST NOT appear below the threshold
// (MIN_COMMENTS_FOR_SUMMARY = 10 in the code). We simulate the threshold by
// posting comments via the API instead of the UI so the spec stays quick.

async function postComment(
  page: Page,
  coords: {
    workspaceSlug: string;
    projectSlug: string;
    taskNumber: number;
  },
  body: string,
): Promise<void> {
  const url = `/api/proxy/workspaces/${coords.workspaceSlug}/projects/${coords.projectSlug}/tasks/${coords.taskNumber}/comments`;
  const resp = await apiPost(page, url, { body });
  expect(resp.ok, `POST ${url} → ${resp.status}`).toBe(true);
}

test.describe('AI — Summarize discussion', () => {
  test.beforeEach(async ({ page }) => {
    await pinEnglishLocale(page);
    await mockExternalIntegrations(page);
  });

  test('button hidden below threshold; visible past it; posts summary as comment', async ({
    page,
  }) => {
    const account = await onboardAccount(page);
    await stubAiUsage(page, {
      workspaceSlug: account.workspaceSlug,
      consent: { accepted: true },
    });
    await stubAiSse(page, account.workspaceSlug, /\/ai\/tasks\/[^/]+\/comments\/summarize$/, {
      frames: [{ event: 'message', data: 'Team agrees to ship on Friday.' }],
    });

    const project = await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Discussion-heavy task');
    let drawer = await openDrawer(card);

    // Below threshold — the button is not rendered at all.
    await expect(
      drawer.getByRole('button', { name: /Summarize this discussion with AI/i }),
    ).toHaveCount(0);

    // Close, post 10 comments through the API, reopen.
    await page.keyboard.press('Escape');
    for (let i = 1; i <= 10; i += 1) {
      await postComment(
        page,
        { workspaceSlug: account.workspaceSlug, projectSlug: project.slug, taskNumber: 1 },
        `Comment number ${i}`,
      );
    }
    drawer = await openDrawer(card);

    const summarize = drawer.getByRole('button', { name: /Summarize this discussion with AI/i });
    await expect(summarize).toBeVisible();
    await summarize.click();

    const region = drawer.getByRole('region', { name: /Discussion summary/i });
    await expect(region).toBeVisible();
    await expect(region.getByText(/Team agrees to ship on Friday/)).toBeVisible({ timeout: 5000 });
    // AI badge accompanies the summary.
    await expect(region.getByRole('note', { name: /ai-generated/i })).toBeVisible();

    // Post-as-comment writes the summary into the composer draft.
    await region.getByRole('button', { name: /Post as comment/i }).click();
    // The composer draft is prefixed with "_(AI summary)_" — poll the
    // composer textarea's value until React flushes the state update.
    await expect
      .poll(async () => {
        const values = await drawer
          .locator('textarea')
          .evaluateAll((els) => (els as HTMLTextAreaElement[]).map((el) => el.value));
        return values.some((v) => /AI summary/i.test(v));
      })
      .toBe(true);
  });
});
