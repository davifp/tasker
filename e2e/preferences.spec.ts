import { test, expect } from '@playwright/test';
import { onboardAccount, signIn } from './support/auth';
import { mockExternalIntegrations, pinEnglishLocale } from './support/mocks';
import { createProject, openDrawer, quickAddTask } from './support/board';
import { inviteAndJoin } from './support/realtime';

// Peer opts out of EMAIL notifications for the COMMENT_FOLLOWED event. When
// the owner subsequently comments on a task the peer follows, the peer's
// bell still updates (IN_APP stays on) but no email hits MailHog.
test.describe('Notification preferences', () => {
  test.beforeEach(async ({ page }) => {
    await mockExternalIntegrations(page);
    await pinEnglishLocale(page);
  });

  test('disabling EMAIL for COMMENT_FOLLOWED suppresses only the email', async ({
    page,
    browser,
  }) => {
    const owner = await onboardAccount(page, { displayName: 'Owner Alice' });
    const project = await createProject(page);
    const card = await quickAddTask(page, 'To do', 'Preferences target');

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
      redirectTo: `/${owner.workspaceSlug}/settings/notifications`,
    });

    // ---- Peer turns off EMAIL for COMMENT_FOLLOWED -----------------------
    const emailFollowed = peerPage.locator('#pref-COMMENT_FOLLOWED\\:EMAIL');
    await expect(emailFollowed).toBeVisible();
    if (await emailFollowed.isChecked()) {
      await emailFollowed.uncheck();
    }
    await peerPage.getByRole('button', { name: /save preferences/i }).click();
    await expect(peerPage.getByText(/preferences saved/i)).toBeVisible({ timeout: 5_000 });

    // ---- Peer becomes a follower by commenting first ---------------------
    await peerPage.goto(`/${owner.workspaceSlug}/projects/${project.slug}/board`);
    const peerCard = peerPage
      .getByRole('button', { name: /open task #\d+: preferences target/i })
      .first();
    const peerDrawer = await openDrawer(peerCard);
    const peerComments = peerDrawer.getByRole('region', { name: /^comments$/i });
    await peerComments.getByLabel(/write a comment/i).fill('I will take a look');
    await peerComments.getByRole('button', { name: /^add$/i }).click();
    await expect(peerComments.getByText('I will take a look')).toBeVisible();

    // ---- Owner posts a plain comment (no mention) ------------------------
    const ownerDrawer = await openDrawer(card);
    const ownerComments = ownerDrawer.getByRole('region', { name: /^comments$/i });
    await ownerComments.getByLabel(/write a comment/i).fill('Thanks Bob');
    await ownerComments.getByRole('button', { name: /^add$/i }).click();
    await expect(ownerComments.getByText('Thanks Bob')).toBeVisible();

    // ---- Bell + list should still show the COMMENT_FOLLOWED item ---------
    await peerPage.goto(`/${owner.workspaceSlug}/notifications`);
    await expect(peerPage.getByText(/preferences target/i)).toBeVisible({ timeout: 5_000 });

    // ---- MailHog: assert no COMMENT_FOLLOWED email arrived ---------------
    // Batcher window is 5 s in the test env; wait 12 s and then scan for any
    // message addressed to the peer that references the target task. The
    // mailbox is shared across parallel workers, so we filter by BOTH the
    // recipient address (per-worker unique) AND the task title.
    await peerPage.waitForTimeout(12_000);
    const mailhogUrl = process.env['MAILHOG_URL'] ?? 'http://localhost:8025';
    const response = await peerPage.request.get(`${mailhogUrl}/api/v2/messages`);
    const inbox = (await response.json()) as {
      items: Array<{ Content: { Headers: { To?: string[] }; Body: string } }>;
    };
    const matching = inbox.items.filter(
      (msg) =>
        (msg.Content.Headers.To?.[0]?.includes(member.email) ?? false) &&
        msg.Content.Body.includes('Preferences target'),
    );
    expect(matching, 'Expected no COMMENT_FOLLOWED email but MailHog had one').toHaveLength(0);

    await peerContext.close();
  });
});
