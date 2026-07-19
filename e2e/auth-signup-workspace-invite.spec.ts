import { test, expect } from '@playwright/test';
import { extractFirstUrl, waitForEmail } from './support/mailhog';
import { randomEmail, randomWorkspaceName } from './support/factories';

test.describe('signup → verify email → create workspace → invite', () => {
  // No MailHog purge: the inbox is shared across parallel workers and wiping
  // it here would delete verification mails other workers are polling for.
  // `waitForEmail` matches by the unique per-test email address anyway.

  test('team lead completes the mandatory onboarding flow', async ({ page }) => {
    const email = randomEmail('lead');
    const password = 'Sup3r!Passw0rd';
    const workspaceName = randomWorkspaceName();

    await page.goto('/signup');
    await page.getByLabel(/full name/i).fill('Ada Lovelace');
    await page.getByLabel(/work email/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/verify-email/);

    const verificationMail = await waitForEmail(
      (mail) => mail.Content.Headers.To?.[0]?.includes(email) ?? false,
    );
    const verifyUrl = extractFirstUrl(verificationMail.Content.Body);
    expect(verifyUrl).not.toBeNull();
    if (!verifyUrl) return;

    await page.goto(verifyUrl);
    await expect(page.getByText(/email verified/i)).toBeVisible();

    await page.goto('/workspaces/new');
    await page.getByLabel(/workspace name/i).fill(workspaceName);
    await page.getByRole('button', { name: /create workspace/i }).click();

    await expect(page).toHaveURL(/\/[^/]+\/projects/);

    // Invite 3 teammates
    await page
      .getByRole('link', { name: /members/i })
      .first()
      .click();
    await page.getByRole('button', { name: /invite people/i }).click();

    for (let i = 0; i < 3; i += 1) {
      if (i > 0) await page.getByRole('button', { name: /add another/i }).click();
      const emailFields = await page.getByLabel(/^email$/i).all();
      const target = emailFields[emailFields.length - 1];
      await target?.fill(randomEmail('teammate'));
    }

    await page.getByRole('button', { name: /send invitations/i }).click();
    await expect(page.getByText(/invitations sent/i)).toBeVisible();
  });
});
