import { test, expect } from '@playwright/test';
import { onboardAccount, signIn } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject, openDrawer, quickAddTask } from './support/board';
import { inviteAndJoin } from './support/realtime';
import { waitForEmail } from './support/mailhog';

// End-to-end coverage for the mention path:
//   1. User A mentions user B in a comment.
//   2. User B's bell badge lights up via the realtime socket (in-app channel).
//   3. The `/notifications` page shows the freshly-arrived item.
//   4. MailHog receives a mention email once the batcher window closes.
//
// The email leg depends on NOTIF_EMAIL_BATCH_WINDOW_S being small in the
// test env (`playwright.config.ts` sets it to 5 s) so the drain happens
// inside the test timeout.
test.describe('Mention notification', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('bell + list + email land when user A mentions user B', async ({ page, browser }) => {
    // ---- Setup: two users in one workspace, one shared task --------------
    const owner = await onboardAccount(page, { displayName: 'Owner Alice' });
    const project = await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Mention target');

    const peerContext = await browser.newContext();
    const member = await inviteAndJoin({
      workspaceSlug: owner.workspaceSlug,
      inviterPage: page,
      inviteeContext: peerContext,
      displayName: 'Peer Bob',
    });

    const peerPage = await peerContext.newPage();
    await mockExternalIntegrations(peerPage);
    await pinEnglishLocale(peerPage);
    await signIn(peerPage, {
      email: member.email,
      password: member.password,
      redirectTo: `/${owner.workspaceSlug}/projects/${project.slug}/board`,
    });
    // Peer must be authenticated & have their socket open before A comments,
    // otherwise the badge update won't be observable until the polling
    // fallback ticks.
    const bell = peerPage.getByRole('button', { name: /notifications/i }).first();
    await expect(bell).toBeVisible();

    // ---- Owner posts a comment mentioning the peer -----------------------
    const drawer = await openDrawer(card);
    const commentsSection = drawer.getByRole('region', { name: /^comments$/i });
    const composer = commentsSection.getByLabel(/write a comment/i);
    await composer.click();
    await composer.pressSequentially(`Hey @${member.displayName.split(' ')[0]}`);

    // Mention popover renders as a listbox anchored to the composer.
    const picker = page.getByRole('listbox');
    await expect(picker).toBeVisible();
    await picker.getByRole('option').filter({ hasText: 'Peer Bob' }).first().click();
    await composer.pressSequentially(' please review');
    await commentsSection.getByRole('button', { name: /^add$/i }).click();
    await expect(commentsSection.getByText(/please review/)).toBeVisible();

    // ---- Peer surface: unread bell badge ---------------------------------
    const unreadBadge = peerPage.getByRole('button', { name: /notifications.*unread/i }).first();
    await expect(unreadBadge).toBeVisible({ timeout: 5_000 });

    // ---- Peer surface: /notifications page shows the item ----------------
    await peerPage.goto(`/${owner.workspaceSlug}/notifications`);
    await expect(peerPage.getByRole('heading', { name: /notifications/i })).toBeVisible();
    await expect(peerPage.getByText('Mention target')).toBeVisible({ timeout: 5_000 });
    // The event summary comes from the `event.COMMENT_MENTION` translation.
    await expect(peerPage.getByText(/mentioned you/i).first()).toBeVisible();

    // ---- MailHog: the drain sent a mention email -------------------------
    const mail = await waitForEmail(
      (msg) =>
        (msg.Content.Headers.To?.[0]?.includes(member.email) ?? false) &&
        /mention/i.test(msg.Content.Headers.Subject?.[0] ?? ''),
      15_000,
    );
    expect(mail.Content.Body).toContain('Mention target');

    await peerContext.close();
  });
});
