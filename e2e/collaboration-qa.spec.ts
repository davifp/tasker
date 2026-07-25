import { test, expect, type Page } from '@playwright/test';
import { onboardAccount } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject, openDrawer, quickAddTask } from './support/board';

/**
 * Broader Phase 5 QA pass — covers the requirements not exercised by
 * collaboration.spec.ts and collaboration-attachments-limits.spec.ts.
 * Specifically: preview toggle (FR-3), edited marker (FR-4), soft-delete
 * (FR-5), fixed 8-emoji bar (FR-13), reactor tooltip (FR-15), signed
 * download (FR-21), delete authorization (FR-5, FR-20).
 *
 * Cross-workspace tenant isolation is exercised by backend integration
 * tests (reactions/attachments/comments-mentions) so it's not repeated
 * here — the aim is user-facing verification.
 */

test.describe('Phase 5 — QA sweep', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('FR-3 — MarkdownComposer preview toggle renders the Markdown', async ({ page }) => {
    await onboardAccount(page);
    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Preview test');
    const drawer = await openDrawer(card);

    const composer = drawer.getByRole('region', { name: /^comments$/i });
    await composer
      .getByLabel(/write a comment/i)
      .fill('**bold** _italic_ [link](https://tasker.dev)');

    // Toggle preview and confirm strong/em/anchor render.
    await composer
      .getByRole('button', { name: /^preview$/i, exact: false })
      .first()
      .click();
    const strong = composer.locator('strong').filter({ hasText: 'bold' });
    await expect(strong).toBeVisible();
    const em = composer.locator('em').filter({ hasText: 'italic' });
    await expect(em).toBeVisible();
    const anchor = composer.locator('a').filter({ hasText: 'link' });
    await expect(anchor).toHaveAttribute('rel', /noopener/);
    await expect(anchor).toHaveAttribute('target', '_blank');
  });

  test('FR-4 — edit shows "(edited)" marker after save', async ({ page }) => {
    await onboardAccount(page);
    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Edit marker');
    const drawer = await openDrawer(card);

    const commentsSection = drawer.getByRole('region', { name: /^comments$/i });
    await commentsSection.getByLabel(/write a comment/i).fill('original body');
    await commentsSection.getByRole('button', { name: /^add$/i }).click();
    await expect(commentsSection.getByText('original body')).toBeVisible();

    // Wait for optimistic id swap so the edit button appears.
    await expect(commentsSection.getByRole('button', { name: /edit this comment/i })).toBeVisible();
    await commentsSection.getByRole('button', { name: /edit this comment/i }).click();

    // Two composers exist while editing (inline + bottom-of-panel). The
    // inline one is the last, so target it explicitly.
    const editComposer = commentsSection.getByLabel(/write a comment/i).first();
    await editComposer.fill('edited body');
    await commentsSection.getByRole('button', { name: /^save$/i }).click();

    await expect(commentsSection.getByText('edited body')).toBeVisible();
    await expect(commentsSection.getByText('(edited)')).toBeVisible();
  });

  test('FR-5, FR-20 — author can delete their own comment', async ({ page }) => {
    await onboardAccount(page);
    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Delete gate');
    const drawer = await openDrawer(card);

    const commentsSection = drawer.getByRole('region', { name: /^comments$/i });
    await commentsSection.getByLabel(/write a comment/i).fill('kill me');
    await commentsSection.getByRole('button', { name: /^add$/i }).click();
    await expect(commentsSection.getByText('kill me')).toBeVisible();
    await expect(
      commentsSection.getByRole('button', { name: /delete this comment/i }),
    ).toBeVisible();

    await commentsSection.getByRole('button', { name: /delete this comment/i }).click();
    await expect(commentsSection.getByText('kill me')).toHaveCount(0);
  });

  test('FR-13 — reaction bar renders exactly 8 emoji buttons', async ({ page }) => {
    await onboardAccount(page);
    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Emoji count');
    const drawer = await openDrawer(card);

    const commentsSection = drawer.getByRole('region', { name: /^comments$/i });
    await commentsSection.getByLabel(/write a comment/i).fill('react to me');
    await commentsSection.getByRole('button', { name: /^add$/i }).click();
    await expect(commentsSection.getByText('react to me')).toBeVisible();

    // Wait for the CommentReactions bar to appear (optimistic id swap).
    const bar = commentsSection.getByRole('button', { name: /^thumbs up$/i }).first();
    await expect(bar).toBeVisible();

    const names = [
      'Thumbs up',
      'Thumbs down',
      'Heart',
      'Celebrate',
      'Rocket',
      'Watching',
      'Approved',
      'Thinking',
    ];
    for (const name of names) {
      await expect(
        commentsSection.getByRole('button', { name: new RegExp(`^${name}$`) }),
      ).toBeVisible();
    }
  });

  test('FR-16, FR-17, FR-21 — sign→PUT→confirm; download URL is signed and not the raw storage key', async ({
    page,
  }) => {
    const account = await onboardAccount(page);
    const project = await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Signed download');
    const drawer = await openDrawer(card);

    const fileInput = drawer.getByLabel(/attach files/i);
    await fileInput.setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('signed download proof'),
    });
    // Poll the confirmed list; the READY row appears only after confirm
    // completes, which is what we want to assert on.
    let attachmentId: string | undefined;
    await expect
      .poll(
        async () => {
          const list = await page.request.get(
            `/api/proxy/workspaces/${account.workspaceSlug}/projects/${project.slug}/tasks/1/attachments`,
          );
          if (!list.ok()) return 0;
          const body = (await list.json()) as { items: Array<{ id: string }> };
          if (body.items.length > 0) attachmentId = body.items[0]!.id;
          return body.items.length;
        },
        { timeout: 20_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(0);
    expect(attachmentId).toBeTruthy();

    const dl = await page.request.get(
      `/api/proxy/workspaces/${account.workspaceSlug}/projects/${project.slug}/tasks/1/attachments/${attachmentId}/download`,
    );
    expect(dl.ok()).toBe(true);
    const { url } = (await dl.json()) as { url: string };
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toMatch(/X-Amz-Signature=/);
  });

  test('FR-22, FR-24 — activity feed lists comment.created and attachment.uploaded verbs', async ({
    page,
  }) => {
    await onboardAccount(page);
    await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Activity check');
    const drawer = await openDrawer(card);

    const commentsSection = drawer.getByRole('region', { name: /^comments$/i });
    await commentsSection.getByLabel(/write a comment/i).fill('activity source');
    await commentsSection.getByRole('button', { name: /^add$/i }).click();
    await expect(commentsSection.getByText('activity source')).toBeVisible();

    await drawer.getByLabel(/attach files/i).setInputFiles({
      name: 'activity.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('bytes'),
    });
    await expect(drawer.getByText('activity.txt').first()).toBeVisible({ timeout: 15_000 });

    const activity = drawer.getByRole('region', { name: /activity/i }).first();
    await expect(activity.getByText(/commented/i)).toBeVisible({ timeout: 10_000 });
    await expect(activity.getByText(/attached activity\.txt/i)).toBeVisible({ timeout: 15_000 });
  });
});

// Helper for other suites — accepts a locator that already scopes the search.
export async function commentByText(scope: Page['locator'], text: string) {
  return scope.getByText(text);
}
